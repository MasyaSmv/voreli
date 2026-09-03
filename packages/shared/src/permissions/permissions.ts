/**
 * Permissions are a 64-bit mask rather than rows in a table: the check runs on every
 * message, every channel listing and every voice join, so it has to be arithmetic on a
 * number instead of a query. The flags live here because the client hides buttons by the
 * same bits the server enforces — one definition, two consumers.
 */
export const Permission = {
  /** See the channel at all. Denying this hides the channel from the sidebar. */
  ViewChannel: 1n << 0n,
  SendMessages: 1n << 1n,
  /** Edit or delete other people's messages. */
  ManageMessages: 1n << 2n,
  AttachFiles: 1n << 3n,
  AddReactions: 1n << 4n,
  MentionEveryone: 1n << 5n,

  /** Join a voice channel. */
  Connect: 1n << 10n,
  Speak: 1n << 11n,
  ShareScreen: 1n << 12n,
  /** Server-side mute of other members, as opposed to muting yourself. */
  MuteMembers: 1n << 13n,
  DeafenMembers: 1n << 14n,
  MoveMembers: 1n << 15n,

  CreateInvite: 1n << 20n,
  ManageChannels: 1n << 21n,
  ManageRoles: 1n << 22n,
  ManageServer: 1n << 23n,
  KickMembers: 1n << 24n,
  BanMembers: 1n << 25n,

  /** Grants everything and ignores every channel override. Hand out sparingly. */
  Administrator: 1n << 40n,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS: bigint = Object.values(Permission).reduce(
  (mask, flag) => mask | flag,
  0n,
);

/** Sensible starting point for @everyone: talk and listen, change nothing. */
export const DEFAULT_EVERYONE_PERMISSIONS: bigint =
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.AttachFiles |
  Permission.AddReactions |
  Permission.Connect |
  Permission.Speak |
  Permission.ShareScreen;

export interface PermissionOverride {
  readonly allow: bigint;
  readonly deny: bigint;
}

export interface PermissionContext {
  /** The server owner bypasses every check, including channel overrides. */
  readonly isOwner: boolean;
  /** Mask of the @everyone role — the base every member starts from. */
  readonly everyonePermissions: bigint;
  /** Masks of the roles this member holds, in any order. */
  readonly rolePermissions: readonly bigint[];
  /** Channel override attached to @everyone, if the channel has one. */
  readonly everyoneOverride?: PermissionOverride;
  /** Channel overrides attached to the member's roles, in any order. */
  readonly roleOverrides?: readonly PermissionOverride[];
  /** Channel override attached to this member personally. */
  readonly memberOverride?: PermissionOverride;
}

/**
 * Resolves the effective mask in the three steps the product promises: @everyone, then
 * roles, then channel overrides.
 *
 * The order inside the third step matters and is not arbitrary — all denies of a tier are
 * applied before all allows of that tier, so that a single role granting a permission wins
 * over another role denying it. Discord behaves the same way, and users carry that
 * expectation over (see docs/reference/discord.md).
 */
export function computePermissions(context: PermissionContext): bigint {
  if (context.isOwner) {
    return ALL_PERMISSIONS;
  }

  let mask = context.rolePermissions.reduce(
    (acc, rolePermission) => acc | rolePermission,
    context.everyonePermissions,
  );

  if ((mask & Permission.Administrator) !== 0n) {
    return ALL_PERMISSIONS;
  }

  if (context.everyoneOverride) {
    mask &= ~context.everyoneOverride.deny;
    mask |= context.everyoneOverride.allow;
  }

  const roleOverrides = context.roleOverrides ?? [];
  const roleDeny = roleOverrides.reduce((acc, override) => acc | override.deny, 0n);
  const roleAllow = roleOverrides.reduce((acc, override) => acc | override.allow, 0n);
  mask &= ~roleDeny;
  mask |= roleAllow;

  if (context.memberOverride) {
    mask &= ~context.memberOverride.deny;
    mask |= context.memberOverride.allow;
  }

  return mask;
}

export function hasPermission(mask: bigint, permission: bigint): boolean {
  return (mask & permission) === permission;
}

/**
 * Masks cross the network as decimal strings: JSON has no bigint, and a 64-bit mask does
 * not survive a round trip through a double.
 */
export function serializePermissions(mask: bigint): string {
  return mask.toString(10);
}

export function parsePermissions(raw: string): bigint {
  return BigInt(raw);
}
