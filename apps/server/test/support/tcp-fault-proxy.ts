import { createConnection, createServer, type Socket } from "node:net";

/** Forwards real TCP traffic; faults affect only clients routed through this proxy. */
export class TcpFaultProxy {
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((socket) => this.accept(socket));
  private mode: "forward" | "disconnect" | "stall" = "forward";

  constructor(private readonly upstream: URL) {}

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("TCP proxy has no port");
    }
    const url = new URL(this.upstream);
    url.hostname = "127.0.0.1";
    url.port = String(address.port);
    return url.toString();
  }

  fault(mode: "forward" | "disconnect" | "stall"): void {
    this.mode = mode;
    for (const socket of this.sockets) socket.destroy();
  }

  stallTraffic(): void {
    this.mode = "stall";
    for (const socket of this.sockets) socket.pause();
  }

  async close(): Promise<void> {
    this.fault("disconnect");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TCP proxy close timed out")), 2_000);
      this.server.close((error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private accept(client: Socket): void {
    this.track(client);
    if (this.mode === "disconnect") {
      client.destroy();
      return;
    }
    if (this.mode === "stall") return;

    const upstream = createConnection({
      host: this.upstream.hostname,
      port: Number(this.upstream.port || 6379),
    });
    this.track(upstream);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.pipe(upstream).pipe(client);
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", (error: Error) => {
      console.warn("TCP fault proxy socket closed", { error });
      socket.destroy();
    });
  }
}
