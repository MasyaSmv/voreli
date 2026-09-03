import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  computePermissions,
  hasPermission,
  parsePermissions,
  Permission,
  type PermissionContext,
  serializePermissions,
} from "./permissions.js";

const base: PermissionContext = {
  isOwner: false,
  everyonePermissions: Permission.ViewChannel | Permission.SendMessages,
  rolePermissions: [],
};

describe("computePermissions", () => {
  it("starts from the @everyone mask", () => {
    const mask = computePermissions(base);

    expect(hasPermission(mask, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(mask, Permission.ManageChannels)).toBe(false);
  });

  it("adds every role the member holds", () => {
    const mask = computePermissions({
      ...base,
      rolePermissions: [Permission.ManageMessages, Permission.KickMembers],
    });

    expect(hasPermission(mask, Permission.ManageMessages)).toBe(true);
    expect(hasPermission(mask, Permission.KickMembers)).toBe(true);
  });

  it("gives the owner everything, ignoring even a denying override", () => {
    const mask = computePermissions({
      ...base,
      isOwner: true,
      everyonePermissions: 0n,
      memberOverride: { allow: 0n, deny: ALL_PERMISSIONS },
    });

    expect(mask).toBe(ALL_PERMISSIONS);
  });

  it("gives an administrator everything without touching overrides", () => {
    const mask = computePermissions({
      ...base,
      rolePermissions: [Permission.Administrator],
      everyoneOverride: { allow: 0n, deny: Permission.ViewChannel },
    });

    expect(mask).toBe(ALL_PERMISSIONS);
  });

  it("applies the @everyone channel override on top of roles", () => {
    const mask = computePermissions({
      ...base,
      everyoneOverride: { allow: 0n, deny: Permission.SendMessages },
    });

    expect(hasPermission(mask, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(mask, Permission.SendMessages)).toBe(false);
  });

  it("lets one role allow what another role denies in the same channel", () => {
    const mask = computePermissions({
      ...base,
      roleOverrides: [
        { allow: 0n, deny: Permission.SendMessages },
        { allow: Permission.SendMessages, deny: 0n },
      ],
    });

    expect(hasPermission(mask, Permission.SendMessages)).toBe(true);
  });

  it("lets a personal override win over the role tier", () => {
    const mask = computePermissions({
      ...base,
      roleOverrides: [{ allow: Permission.SendMessages, deny: 0n }],
      memberOverride: { allow: 0n, deny: Permission.SendMessages },
    });

    expect(hasPermission(mask, Permission.SendMessages)).toBe(false);
  });

  it("hides a channel when ViewChannel is denied at the channel level", () => {
    const mask = computePermissions({
      ...base,
      memberOverride: { allow: 0n, deny: Permission.ViewChannel },
    });

    expect(hasPermission(mask, Permission.ViewChannel)).toBe(false);
  });
});

describe("hasPermission", () => {
  it("requires every bit of a compound permission to be present", () => {
    const both = Permission.Connect | Permission.Speak;

    expect(hasPermission(Permission.Connect, both)).toBe(false);
    expect(hasPermission(both, both)).toBe(true);
  });
});

describe("serialization", () => {
  it("survives a round trip through the string form used on the wire", () => {
    expect(parsePermissions(serializePermissions(ALL_PERMISSIONS))).toBe(ALL_PERMISSIONS);
  });

  it("keeps a high bit that a double would round away", () => {
    // Not a permission we define today, but the column is 64-bit and the wire format has
    // to hold whatever fits in it. A lone power of two survives a double; a high bit with
    // a low bit set next to it does not.
    const high = (1n << 62n) | 1n;

    expect(parsePermissions(serializePermissions(high))).toBe(high);
    expect(BigInt(Number(serializePermissions(high)))).not.toBe(high);
  });
});
