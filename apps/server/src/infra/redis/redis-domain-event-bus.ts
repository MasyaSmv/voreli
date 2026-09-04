import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { RedisClientType } from "redis";

import {
  type DomainEventBus,
  type DomainEventHandler,
  type DomainEventMap,
  type DomainEventName,
} from "../../common/events/domain-event-bus.js";
import { RedisClientFactory } from "./redis-client.factory.js";

const EVENT_NAMES: readonly DomainEventName[] = [
  "session.revoked",
  "member.roles.changed",
  "channel.overrides.changed",
  "member.removed",
  "member.joined",
];

const CHANNEL_PREFIX = "voreli:domain-events:";

function channelOf(name: DomainEventName): string {
  return `${CHANNEL_PREFIX}${name}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parsePayload<Name extends DomainEventName>(
  name: Name,
  serialized: string,
): DomainEventMap[Name] | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (name === "session.revoked") {
    return nonEmptyString(record["sessionId"]) && nonEmptyString(record["userId"])
      ? (record as unknown as DomainEventMap[Name])
      : null;
  }

  if (name === "member.roles.changed" || name === "member.removed" || name === "member.joined") {
    return nonEmptyString(record["serverId"]) && nonEmptyString(record["userId"])
      ? (record as unknown as DomainEventMap[Name])
      : null;
  }

  return nonEmptyString(record["channelId"]) ? (record as unknown as DomainEventMap[Name]) : null;
}

/**
 * Redis pub/sub transport.
 *
 * Per-instance handlers reach the publishing process the same way they reach every other
 * one — through Redis — so no instance is a special case. Shared handlers never travel:
 * they run inline, before the message is sent.
 */
@Injectable()
export class RedisDomainEventBus implements DomainEventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisDomainEventBus.name);
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly handlers = new Map<DomainEventName, Set<DomainEventHandler<DomainEventName>>>();
  private readonly sharedHandlers = new Map<
    DomainEventName,
    Set<DomainEventHandler<DomainEventName>>
  >();

  constructor(clients: RedisClientFactory) {
    this.publisher = clients.create();
    this.subscriber = clients.create();

    this.publisher.on("error", (error: Error) => {
      this.logger.error({ message: "Domain event Redis publisher error", error });
    });
    this.subscriber.on("error", (error: Error) => {
      this.logger.error({ message: "Domain event Redis subscriber error", error });
    });
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);

    await Promise.all(
      EVENT_NAMES.map((name) =>
        this.subscriber.subscribe(channelOf(name), (serialized) => {
          void this.dispatch(name, serialized);
        }),
      ),
    );

    this.logger.log("Domain event bus connected");
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.publisher.isOpen ? this.publisher.quit() : Promise.resolve(),
      this.subscriber.isOpen ? this.subscriber.quit() : Promise.resolve(),
    ]);
  }

  async publish<Name extends DomainEventName>(
    name: Name,
    payload: DomainEventMap[Name],
  ): Promise<void> {
    // Before the fan-out, not as a reaction to it. A cache version counter bumped by a
    // subscriber is bumped one Redis round trip too late: in that window every instance,
    // this one included, still answers from the entry the write just invalidated.
    await this.runAll(this.sharedHandlers.get(name), name, payload);

    try {
      await this.publisher.publish(channelOf(name), JSON.stringify(payload));
    } catch (error: unknown) {
      this.logger.error({
        message: "Domain event publication failed",
        error,
        eventName: name,
        payload,
        operation: "publishDomainEvent",
      });
    }
  }

  subscribe<Name extends DomainEventName>(
    name: Name,
    handler: DomainEventHandler<Name>,
  ): () => void {
    return register(this.handlers, name, handler);
  }

  subscribeShared<Name extends DomainEventName>(
    name: Name,
    handler: DomainEventHandler<Name>,
  ): () => void {
    return register(this.sharedHandlers, name, handler);
  }

  private async dispatch<Name extends DomainEventName>(
    name: Name,
    serialized: string,
  ): Promise<void> {
    const payload = parsePayload(name, serialized);

    if (payload === null) {
      this.logger.error({
        message: "Invalid domain event payload received",
        eventName: name,
        serialized,
        operation: "consumeDomainEvent",
      });

      return;
    }

    await this.runAll(this.handlers.get(name), name, payload);
  }

  /** One failing handler must not keep the others from running, so each is caught alone. */
  private async runAll<Name extends DomainEventName>(
    handlers: ReadonlySet<DomainEventHandler<DomainEventName>> | undefined,
    name: Name,
    payload: DomainEventMap[Name],
  ): Promise<void> {
    if (handlers === undefined) {
      return;
    }

    await Promise.all(
      [...handlers].map(async (handler) => {
        try {
          await handler(payload);
        } catch (error: unknown) {
          this.logger.error({
            message: "Domain event handler failed",
            error,
            eventName: name,
            payload,
            operation: "handleDomainEvent",
          });
        }
      }),
    );
  }
}

function register<Name extends DomainEventName>(
  registry: Map<DomainEventName, Set<DomainEventHandler<DomainEventName>>>,
  name: Name,
  handler: DomainEventHandler<Name>,
): () => void {
  const handlers = registry.get(name) ?? new Set<DomainEventHandler<DomainEventName>>();
  const storedHandler = handler as DomainEventHandler<DomainEventName>;
  handlers.add(storedHandler);
  registry.set(name, handlers);

  return () => {
    handlers.delete(storedHandler);
  };
}
