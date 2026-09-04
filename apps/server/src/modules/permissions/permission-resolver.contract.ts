export const PERMISSION_RESOLVER = Symbol("PERMISSION_RESOLVER");

export interface ResolvedMembership {
  readonly memberId: string;
  readonly serverId: string;
  readonly isOwner: boolean;
  /** Effective mask at server level, before any channel override. */
  readonly serverPermissions: bigint;
  /** Id of the server's @everyone role, needed to tell its override from a plain one. */
  readonly everyoneRoleId: string | null;
  /** Raw material the channel arithmetic needs, carried so it is never re-queried. */
  readonly everyonePermissions: bigint;
  readonly roleIds: readonly string[];
  readonly rolePermissions: readonly bigint[];
}

export interface ResolvedChannelMembership extends ResolvedMembership {
  readonly channelPermissions: bigint;
}

/**
 * Answers "what may this user do here" and nothing else.
 *
 * Declared as a contract because two implementations are not hypothetical: one reads
 * Postgres, the other caches it in Redis and is layered on top. Consumers depend on the
 * token, so inserting the cache changed no guard and no controller.
 */
export interface PermissionResolverContract {
  /** Null when the user is not a member of that server at all. */
  forServer(userId: string, serverId: string): Promise<ResolvedMembership | null>;

  /**
   * Same, with the channel's overrides applied. Null when the user is not a member of the
   * server the channel belongs to, or the channel does not exist.
   */
  forChannel(userId: string, channelId: string): Promise<ResolvedChannelMembership | null>;

  /** Effective channel masks for every channel of a server, in a fixed number of queries. */
  forServerChannels(userId: string, serverId: string): Promise<Map<string, bigint>>;

  /** Same, for a membership the caller already resolved — the guard always has one. */
  channelMasksFor(membership: ResolvedMembership): Promise<Map<string, bigint>>;
}
