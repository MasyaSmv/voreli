import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateEnv } from "../config/env.validation.js";
import { MediaModule } from "./media.module.js";
import { RouterRegistryService } from "./router-registry.service.js";
import { TransportFactory } from "./transport.factory.js";
import { WorkerPoolService } from "./worker-pool.service.js";

describe("media infrastructure", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), MediaModule],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("starts one real worker and multiplexes transports on its configured WebRtcServer", async () => {
    const [slot] = moduleRef.get(WorkerPoolService).all();
    expect(slot).toBeDefined();

    const serverDump = await slot!.webRtcServer.dump();
    expect(serverDump.udpSockets).toContainEqual({ ip: "0.0.0.0", port: 40000 });
    expect(serverDump.tcpServers).toContainEqual({ ip: "0.0.0.0", port: 40000 });

    const registry = moduleRef.get(RouterRegistryService);
    const handle = await registry.acquire("voice-channel-one");
    const transport = await moduleRef.get(TransportFactory).create(handle);
    const transportDump = await transport.dump();

    expect(handle.router.rtpCapabilities.codecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mimeType: "audio/opus", clockRate: 48_000, channels: 2 }),
      ]),
    );
    expect(serverDump.webRtcTransportIds).not.toContain(transport.id);
    expect((await slot!.webRtcServer.dump()).webRtcTransportIds).toContain(transport.id);
    expect(transportDump.id).toBe(transport.id);

    transport.close();
    registry.release("voice-channel-one");
  });

  it("returns the same live Router for concurrent participants of one channel", async () => {
    const registry = moduleRef.get(RouterRegistryService);
    const [first, second] = await Promise.all([
      registry.acquire("voice-channel-two"),
      registry.acquire("voice-channel-two"),
    ]);

    expect(first.router.id).toBe(second.router.id);

    registry.release("voice-channel-two");
    registry.release("voice-channel-two");
  });
});
