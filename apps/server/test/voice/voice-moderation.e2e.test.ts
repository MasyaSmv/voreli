import { createId } from "@paralleldrive/cuid2";
import { Permission } from "@voreli/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  VoiceModerationHierarchyError,
  VoiceModerationPermissionError,
  VoiceModerationSelfError,
} from "../../src/modules/voice/errors/voice-room-errors.js";
import { VoiceParticipantControlService } from "../../src/modules/voice/voice-participant-control.service.js";
import { VoiceRoomService } from "../../src/modules/voice/voice-room.service.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceStateRepository,
} from "../../src/modules/voice/voice-state.repository.js";
import { Factories, type SeededServer, type SeededUser } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("voice moderation", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let actor: SeededUser;
  let target: SeededUser;
  let channelId: string;
  let rooms: VoiceRoomService;
  let controls: VoiceParticipantControlService;
  let state: VoiceStateRepository;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    rooms = harness.app.get(VoiceRoomService);
    controls = harness.app.get(VoiceParticipantControlService);
    state = harness.app.get(VOICE_STATE_REPOSITORY);
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    server = await factories.server();
    actor = await factories.member(server);
    target = await factories.member(server);
    channelId = createId();
    await harness.prisma.db.channel.create({
      data: { id: channelId, serverId: server.serverId, type: "VOICE", name: "Moderated" },
    });
  });

  afterEach(async () => {
    await Promise.all([
      rooms.leaveUser(actor.id),
      rooms.leaveUser(target.id),
      rooms.leaveUser(server.ownerId),
    ]);
    await harness.rollbackTransaction();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("checks mute and deafen permissions independently", async () => {
    await grantActor(Permission.MuteMembers, 10);
    await joinBoth();

    await expect(
      controls.setModeratorState(actor.id, {
        channelId,
        userId: target.id,
        moderatorMuted: true,
        moderatorDeafened: false,
      }),
    ).resolves.toMatchObject({ moderatorMuted: true, moderatorDeafened: false });

    await expect(
      controls.setModeratorState(actor.id, {
        channelId,
        userId: target.id,
        moderatorMuted: true,
        moderatorDeafened: true,
      }),
    ).rejects.toBeInstanceOf(VoiceModerationPermissionError);
  });

  it("keeps moderator mute through self mute transitions and serializes concurrent writers", async () => {
    await grantActor(Permission.MuteMembers, 10);
    await joinBoth();

    await Promise.all([
      controls.setSelfState(target.id, "target-auth", {
        selfMuted: true,
        selfDeafened: false,
      }),
      controls.setModeratorState(actor.id, {
        channelId,
        userId: target.id,
        moderatorMuted: true,
        moderatorDeafened: false,
      }),
    ]);
    const afterSelfUnmute = await controls.setSelfState(target.id, "target-auth", {
      selfMuted: false,
      selfDeafened: false,
    });

    expect(afterSelfUnmute).toMatchObject({ selfMuted: false, moderatorMuted: true });
    await expect(state.participant(channelId, target.id)).resolves.toMatchObject({
      selfMuted: false,
      moderatorMuted: true,
    });
  });

  it("keeps moderator deafen independent from self deafen", async () => {
    await grantActor(Permission.DeafenMembers, 10);
    await joinBoth();

    await controls.setModeratorState(actor.id, {
      channelId,
      userId: target.id,
      moderatorMuted: false,
      moderatorDeafened: true,
    });
    await controls.setSelfState(target.id, "target-auth", {
      selfMuted: false,
      selfDeafened: true,
    });
    const afterSelfUndeafen = await controls.setSelfState(target.id, "target-auth", {
      selfMuted: false,
      selfDeafened: false,
    });

    expect(afterSelfUndeafen).toMatchObject({
      selfDeafened: false,
      moderatorDeafened: true,
    });
  });

  it("rejects self moderation and targets at an equal role position", async () => {
    await grantActor(Permission.MuteMembers, 10);
    await grantTarget(10);
    await joinBoth();

    await expect(
      controls.setModeratorState(actor.id, {
        channelId,
        userId: actor.id,
        moderatorMuted: true,
        moderatorDeafened: false,
      }),
    ).rejects.toBeInstanceOf(VoiceModerationSelfError);
    await expect(
      controls.setModeratorState(actor.id, {
        channelId,
        userId: target.id,
        moderatorMuted: true,
        moderatorDeafened: false,
      }),
    ).rejects.toBeInstanceOf(VoiceModerationHierarchyError);
  });

  it("never allows the server owner to become a moderation target", async () => {
    await grantActor(Permission.MuteMembers | Permission.DeafenMembers, 100);
    await rooms.join(actor.id, "actor-auth", "actor-socket", channelId);
    await rooms.join(server.ownerId, "owner-auth", "owner-socket", channelId);

    await expect(
      controls.setModeratorState(actor.id, {
        channelId,
        userId: server.ownerId,
        moderatorMuted: true,
        moderatorDeafened: true,
      }),
    ).rejects.toBeInstanceOf(VoiceModerationHierarchyError);
  });

  async function joinBoth(): Promise<void> {
    await rooms.join(actor.id, "actor-auth", "actor-socket", channelId);
    await rooms.join(target.id, "target-auth", "target-socket", channelId);
  }

  async function grantActor(permissions: bigint, position: number): Promise<void> {
    await grantRole(actor.memberId, permissions, position, "actor-role");
  }

  async function grantTarget(position: number): Promise<void> {
    await grantRole(target.memberId, 0n, position, "target-role");
  }

  async function grantRole(
    memberId: string,
    permissions: bigint,
    position: number,
    name: string,
  ): Promise<void> {
    await harness.prisma.db.role.create({
      data: {
        id: createId(),
        serverId: server.serverId,
        name,
        permissions,
        position,
        members: { create: { memberId } },
      },
    });
  }
});
