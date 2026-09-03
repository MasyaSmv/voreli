/**
 * HTTP contract for servers, categories, channels, roles and invites.
 *
 * Permission masks travel as decimal strings: JSON has no bigint, and a 64-bit mask does
 * not survive a round trip through a double.
 */
export const SERVER_ROUTES = {
  servers: "/servers",
  server: (id: string) => `/servers/${id}`,
  categories: (serverId: string) => `/servers/${serverId}/categories`,
  category: (id: string) => `/categories/${id}`,
  channels: (serverId: string) => `/servers/${serverId}/channels`,
  channel: (id: string) => `/channels/${id}`,
  channelOverrides: (channelId: string) => `/channels/${channelId}/overrides`,
  channelOverride: (channelId: string, targetId: string) =>
    `/channels/${channelId}/overrides/${targetId}`,
  roles: (serverId: string) => `/servers/${serverId}/roles`,
  role: (id: string) => `/roles/${id}`,
  memberRole: (memberId: string, roleId: string) => `/members/${memberId}/roles/${roleId}`,
  invites: (serverId: string) => `/servers/${serverId}/invites`,
  invite: (code: string) => `/invites/${code}`,
  joinByInvite: (code: string) => `/invites/${code}/join`,
} as const;

export const SERVER_NAME_MAX_LENGTH = 64;
export const CHANNEL_NAME_MAX_LENGTH = 64;
export const CATEGORY_NAME_MAX_LENGTH = 64;
export const ROLE_NAME_MAX_LENGTH = 64;
export const CHANNEL_TOPIC_MAX_LENGTH = 512;

export type ChannelKind = "TEXT" | "VOICE";

export interface RoleView {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  /** Decimal string of the 64-bit mask. */
  readonly permissions: string;
  readonly position: number;
  readonly isDefault: boolean;
}

export interface ChannelView {
  readonly id: string;
  readonly categoryId: string | null;
  readonly type: ChannelKind;
  readonly name: string;
  readonly topic: string | null;
  readonly position: number;
}

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

export interface ServerSummary {
  readonly id: string;
  readonly name: string;
  readonly iconUrl: string | null;
  readonly isOwner: boolean;
}

/**
 * A server as one member sees it: channels the member may not view are absent, not marked
 * — the list itself must not leak that they exist.
 */
export interface ServerView extends ServerSummary {
  readonly categories: readonly CategoryView[];
  readonly channels: readonly ChannelView[];
  readonly roles: readonly RoleView[];
  /** Effective server-level mask of the requesting member, as a decimal string. */
  readonly permissions: string;
}

export interface InviteView {
  readonly code: string;
  readonly serverId: string;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface CreateServerRequest {
  readonly name: string;
}

export interface UpdateServerRequest {
  readonly name?: string;
}

export interface CreateCategoryRequest {
  readonly name: string;
  readonly position?: number;
}

export interface CreateChannelRequest {
  readonly name: string;
  readonly type: ChannelKind;
  readonly categoryId?: string;
  readonly topic?: string;
  readonly position?: number;
}

export interface UpdateChannelRequest {
  readonly name?: string;
  readonly topic?: string | null;
  readonly categoryId?: string | null;
  readonly position?: number;
}

export interface CreateRoleRequest {
  readonly name: string;
  readonly color?: number;
  /** Decimal string of the mask. */
  readonly permissions?: string;
}

export interface UpdateRoleRequest {
  readonly name?: string;
  readonly color?: number;
  readonly permissions?: string;
  readonly position?: number;
}

/** Exactly one of roleId / memberId identifies the target of a channel override. */
export interface SetChannelOverrideRequest {
  readonly roleId?: string;
  readonly memberId?: string;
  readonly allow: string;
  readonly deny: string;
}

export interface CreateInviteRequest {
  readonly maxUses?: number;
  /** Lifetime in seconds; omitted means the invite never expires. */
  readonly expiresInSeconds?: number;
}

export interface JoinedServerResponse {
  readonly server: ServerSummary;
  readonly memberId: string;
}
