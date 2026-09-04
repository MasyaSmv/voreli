import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from "@voreli/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { VoiceConnectForbiddenError } from "../../src/modules/voice/errors/voice-room-errors.js";
import { VoiceRoomService } from "../../src/modules/voice/voice-room.service.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceStateRepository,
} from "../../src/modules/voice/voice-state.repository.js";
import { Factories, type SeededServer } from "../support/factories.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("voice room lifecycle", () => {
  let harness: TestApp;
  let factories: Factories;
  let server: SeededServer;
  let rooms: VoiceRoomService;
  let state: VoiceStateRepository;
  let firstChannelId: string;
  let secondChannelId: string;

  beforeAll(async () => {
    harness = await createTestApp();
    factories = new Factories(harness.prisma);
    rooms = harness.app.get(VoiceRoomService);
    state = harness.app.get(VOICE_STATE_REPOSITORY);
  });

  beforeEach(async () => {
    await harness.beginTransaction();
    server = await factories.server();
    firstChannelId = await createChannel("VOICE", "First voice");
    secondChannelId = await createChannel("VOICE", "Second voice");
  });

  afterEach(async () => {
    await rooms.leaveUser(server.ownerId);
    await harness.rollbackTransaction();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("joins and resumes the same live media session after a socket disconnect", async () => {
    const joined = await rooms.join(server.ownerId, "socket-one", firstChannelId);
    expect(joined.resumed).toBe(false);
    expect(joined.participants).toHaveLength(1);

    await rooms.disconnect(server.ownerId, "socket-one");
    const resumed = await rooms.join(
      server.ownerId,
      "socket-two",
      firstChannelId,
      joined.sessionId,
    );

    expect(resumed.resumed).toBe(true);
    expect(resumed.sessionId).toBe(joined.sessionId);
  });

  it("leaves the previous voice channel before joining the next one", async () => {
    await rooms.join(server.ownerId, "socket", firstChannelId);
    await rooms.join(server.ownerId, "socket", secondChannelId);

    await expect(state.channelOf(server.ownerId)).resolves.toBe(secondChannelId);
    await expect(state.participants(firstChannelId)).resolves.toEqual([]);
  });

  it("refuses Connect independently from the right to see the channel", async () => {
    const member = await factories.member(server);
    await harness.prisma.db.role.update({
      where: { id: server.everyoneRoleId },
      data: { permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.Connect },
    });

    await expect(rooms.join(member.id, "socket", firstChannelId)).rejects.toBeInstanceOf(
      VoiceConnectForbiddenError,
    );
  });

  async function createChannel(type: "TEXT" | "VOICE", name: string): Promise<string> {
    const id = createId();
    await harness.prisma.db.channel.create({
      data: { id, serverId: server.serverId, type, name },
    });
    return id;
  }
});
