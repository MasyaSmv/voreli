import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RedisClientType } from "redis";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import type { EnvironmentVariables } from "../../config/env.validation.js";
import { RedisClientFactory } from "../../infra/redis/redis-client.factory.js";
import { DatabasePermissionResolver } from "./permission-resolver.service.js";
import type {
  PermissionResolverContract,
  ResolvedChannelMembership,
  ResolvedMembership,
} from "./permission-resolver.contract.js";

const KEY_PREFIX = "voreli:perm:";

interface SerializedMembership {
  readonly memberId: string;
  readonly serverId: string;
  readonly isOwner: boolean;
  readonly serverPermissions: string;
  readonly everyoneRoleId: string | null;
  readonly everyonePermissions: string;
  readonly roleIds: readonly string[];
  readonly rolePermissions: readonly string[];
  readonly channelPermissions?: string;
}

/**
 * Redis cache in front of the database resolver, as a decorator rather than an `if` inside
 * the resolver (rule 3.5): the class below knows nothing about SQL and the class it wraps
 * knows nothing about Redis.
 *
 * Invalidation is by version counter, not by deletion. Deleting every entry a role change
 * affects would mean either a key scan or bookkeeping of who is cached where; bumping one
 * counter that the key embeds makes every stale entry unreachable in a single round trip,
 * and the orphans die of their own TTL.
 *
 * The counter is bumped as a shared effect of the domain event, so it is already raised
 * when the mutation that raised it returns. A wider, revoked permission set therefore
 * cannot outlive the request that revoked it.
 *
 * A permission answer is cheap to recompute and expensive to get wrong, so every Redis
 * failure falls through to the database instead of surfacing.
 */
@Injectable()
export class CachedPermissionResolver
  implements PermissionResolverContract, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CachedPermissionResolver.name);
  private readonly redis: RedisClientType;
  private readonly ttl: number;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly source: DatabasePermissionResolver,
    clients: RedisClientFactory,
    config: ConfigService<EnvironmentVariables, true>,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {
    this.redis = clients.create();
    this.ttl = config.get("PERMISSION_CACHE_TTL", { infer: true });

    this.redis.on("error", (error: Error) => {
      this.logger.error({ message: "Permission cache Redis error", error });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();

    // A role change alters the answer for every channel of every server that user is in,
    // and the event does not say which channels those are. One counter per user covers all
    // of them; role changes are rare enough that the over-invalidation costs nothing.
    //
    // Shared, not per-instance: the counters live in Redis, so one bump invalidates the
    // entry for the whole cluster, and doing it on the publisher means the write that
    // revoked the permission cannot answer its own client before the bump lands.
    this.unsubscribers.push(
      this.events.subscribeShared("member.roles.changed", (event) =>
        this.bump(`v:user:${event.userId}`),
      ),
      this.events.subscribeShared("member.removed", (event) => this.bump(`v:user:${event.userId}`)),
      // "Not a member" is cached like any other answer, so joining has to invalidate it.
      this.events.subscribeShared("member.joined", (event) => this.bump(`v:user:${event.userId}`)),
      this.events.subscribeShared("channel.overrides.changed", (event) =>
        this.bump(`v:channel:${event.channelId}`),
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }

    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }

  async forServer(userId: string, serverId: string): Promise<ResolvedMembership | null> {
    const userVersion = await this.versionOf(`v:user:${userId}`);

    if (userVersion === null) {
      return this.source.forServer(userId, serverId);
    }

    return this.through(`server:${userId}:${serverId}:${userVersion}`, decodeMembership, () =>
      this.source.forServer(userId, serverId),
    );
  }

  async forChannel(userId: string, channelId: string): Promise<ResolvedChannelMembership | null> {
    const versions = await this.versionsOf([`v:user:${userId}`, `v:channel:${channelId}`]);

    if (versions === null) {
      return this.source.forChannel(userId, channelId);
    }

    return this.through(
      `channel:${userId}:${channelId}:${versions.join(":")}`,
      decodeChannelMembership,
      () => this.source.forChannel(userId, channelId),
    );
  }

  /**
   * Not cached, on purpose. Both are called once per server view, already answer in a fixed
   * number of queries, and their result covers every channel at once — caching them would
   * add an invalidation surface far wider than the work it saves.
   */
  async forServerChannels(userId: string, serverId: string): Promise<Map<string, bigint>> {
    return this.source.forServerChannels(userId, serverId);
  }

  async channelMasksFor(membership: ResolvedMembership): Promise<Map<string, bigint>> {
    return this.source.channelMasksFor(membership);
  }

  private async through<T extends ResolvedMembership>(
    key: string,
    decode: (raw: SerializedMembership) => T | null,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = await this.read(key);

    if (cached === null) {
      return null;
    }

    if (cached !== undefined) {
      const decoded = decode(cached);

      if (decoded !== null) {
        return decoded;
      }
    }

    const resolved = await load();
    await this.write(key, resolved);

    return resolved;
  }

  /** `undefined` means "nothing cached"; `null` is a cached "not a member". */
  private async read(key: string): Promise<SerializedMembership | null | undefined> {
    try {
      const raw = await this.redis.get(KEY_PREFIX + key);

      if (raw === null) {
        return undefined;
      }

      return raw === "null" ? null : (JSON.parse(raw) as SerializedMembership);
    } catch (error: unknown) {
      this.logger.error({
        message: "Permission cache read failed, falling back to the database",
        error,
        cacheKey: key,
        operation: "readPermissionCache",
      });

      return undefined;
    }
  }

  private async write(key: string, value: ResolvedMembership | null): Promise<void> {
    try {
      const payload = value === null ? "null" : JSON.stringify(encode(value));
      await this.redis.set(KEY_PREFIX + key, payload, { EX: this.ttl });
    } catch (error: unknown) {
      this.logger.error({
        message: "Permission cache write failed",
        error,
        cacheKey: key,
        operation: "writePermissionCache",
      });
    }
  }

  /** Null when Redis is unreachable — the caller then skips the cache entirely. */
  private async versionOf(key: string): Promise<string | null> {
    const versions = await this.versionsOf([key]);

    return versions?.[0] ?? null;
  }

  private async versionsOf(keys: readonly string[]): Promise<string[] | null> {
    try {
      const values = await this.redis.mGet(keys.map((key) => KEY_PREFIX + key));

      return values.map((value) => value ?? "0");
    } catch (error: unknown) {
      this.logger.error({
        message: "Permission cache version lookup failed, bypassing the cache",
        error,
        cacheKeys: keys,
        operation: "readPermissionCacheVersion",
      });

      return null;
    }
  }

  private async bump(key: string): Promise<void> {
    try {
      await this.redis.incr(KEY_PREFIX + key);
    } catch (error: unknown) {
      this.logger.error({
        message: "Permission cache invalidation failed; entries stay until their TTL",
        error,
        cacheKey: key,
        operation: "invalidatePermissionCache",
      });
    }
  }
}

/** Masks are bigint and JSON has no bigint, so they travel as decimal strings. */
function encode(value: ResolvedMembership | ResolvedChannelMembership): SerializedMembership {
  const channelPermissions = (value as ResolvedChannelMembership).channelPermissions;

  return {
    memberId: value.memberId,
    serverId: value.serverId,
    isOwner: value.isOwner,
    serverPermissions: value.serverPermissions.toString(),
    everyoneRoleId: value.everyoneRoleId,
    everyonePermissions: value.everyonePermissions.toString(),
    roleIds: value.roleIds,
    rolePermissions: value.rolePermissions.map((mask) => mask.toString()),
    ...(channelPermissions === undefined
      ? {}
      : { channelPermissions: channelPermissions.toString() }),
  };
}

function decodeMembership(value: SerializedMembership): ResolvedMembership {
  return {
    memberId: value.memberId,
    serverId: value.serverId,
    isOwner: value.isOwner,
    serverPermissions: BigInt(value.serverPermissions),
    everyoneRoleId: value.everyoneRoleId,
    everyonePermissions: BigInt(value.everyonePermissions),
    roleIds: value.roleIds,
    rolePermissions: value.rolePermissions.map((mask) => BigInt(mask)),
  };
}

/** Null for an entry without a channel mask: treat it as a miss rather than invent one. */
function decodeChannelMembership(value: SerializedMembership): ResolvedChannelMembership | null {
  return value.channelPermissions === undefined
    ? null
    : { ...decodeMembership(value), channelPermissions: BigInt(value.channelPermissions) };
}
