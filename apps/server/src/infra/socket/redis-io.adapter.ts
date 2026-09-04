import { createAdapter } from "@socket.io/redis-adapter";
import { type INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { RedisClientType } from "redis";
import type { ServerOptions, Server as SocketServer } from "socket.io";

import type { RedisClientFactory } from "../redis/redis-client.factory.js";

/**
 * Socket.IO across several server instances.
 *
 * Wired from the first day rather than "when a second instance appears": with one instance
 * it behaves identically, and adding it later means debugging why half the room stopped
 * receiving events in production. A message published by one instance reaches sockets held
 * by another through Redis pub/sub.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private publisher?: RedisClientType;
  private subscriber?: RedisClientType;

  constructor(
    app: INestApplicationContext,
    private readonly clients: RedisClientFactory,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const publisher: RedisClientType = this.clients.create();
    const subscriber: RedisClientType = publisher.duplicate();

    // A dropped Redis connection must not take the process down: Socket.IO keeps working
    // for sockets on this instance, it just stops fanning out to the others.
    publisher.on("error", (error: Error) => {
      this.logger.error("Redis publisher error", error.stack);
    });
    subscriber.on("error", (error: Error) => {
      this.logger.error("Redis subscriber error", error.stack);
    });

    await Promise.all([publisher.connect(), subscriber.connect()]);

    this.publisher = publisher;
    this.subscriber = subscriber;
    this.logger.log("Socket.IO Redis adapter connected");
  }

  override createIOServer(port: number, options?: ServerOptions): SocketServer {
    const server = super.createIOServer(port, options) as SocketServer;

    if (this.publisher && this.subscriber) {
      server.adapter(createAdapter(this.publisher, this.subscriber));
    }

    return server;
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}
