import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import type { RedisClientType } from "redis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { validateEnv } from "../../config/env.validation.js";
import { RedisClientFactory } from "../../infra/redis/redis-client.factory.js";
import { RedisModule } from "../../infra/redis/redis.module.js";
import { VoiceModule } from "./voice.module.js";
import { VOICE_STATE_REPOSITORY, type VoiceStateRepository } from "./voice-state.repository.js";

describe("Redis voice state", () => {
  let moduleRef: TestingModule;
  let repository: VoiceStateRepository;
  let redis: RedisClientType;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        RedisModule,
        VoiceModule,
      ],
    }).compile();
    await moduleRef.init();
    repository = moduleRef.get(VOICE_STATE_REPOSITORY);
    redis = moduleRef.get(RedisClientFactory).create();
    await redis.connect();
  });

  beforeEach(async () => {
    const keys = await redis.keys("voice:*");

    if (keys.length > 0) {
      await redis.del(keys);
    }
  });

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }

    await moduleRef.close();
  });

  it("claims a room idempotently but exposes a foreign owner", async () => {
    const meta = { instanceId: "instance-one", routerId: "router-one", createdAt: now() };

    await expect(repository.claimRoom("channel", meta)).resolves.toBe("instance-one");
    await expect(
      repository.claimRoom("channel", { ...meta, instanceId: "instance-two" }),
    ).resolves.toBe("instance-one");
  });

  it("atomically permits one of two concurrent channel joins", async () => {
    await claim("channel-a");
    await claim("channel-b");

    const results = await Promise.all([
      join({ channelId: "channel-a", socketId: "socket-a", newSessionId: "session-a" }),
      join({ channelId: "channel-b", socketId: "socket-b", newSessionId: "session-b" }),
    ]);

    expect(results.filter((result) => result.kind === "joined")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "other-channel")).toHaveLength(1);
  });

  it("resumes only the disconnected matching session and ignores a late old disconnect", async () => {
    await claim("channel");
    const first = await join({
      channelId: "channel",
      socketId: "old-socket",
      newSessionId: "session",
    });
    expect(first.kind).toBe("joined");

    await expect(
      repository.disconnect("channel", "user", "wrong-socket", now()),
    ).resolves.toBeNull();
    const disconnected = await repository.disconnect("channel", "user", "old-socket", now());
    expect(disconnected?.socketId).toBeNull();

    const resumed = await join({
      channelId: "channel",
      socketId: "new-socket",
      newSessionId: "unused",
      resumeSessionId: "session",
    });
    expect(resumed.kind).toBe("resumed");
    expect(resumed.kind === "resumed" ? resumed.participant.generation : 0).toBe(2);

    await expect(repository.disconnect("channel", "user", "old-socket", now())).resolves.toBeNull();
    await expect(repository.participant("channel", "user")).resolves.toMatchObject({
      socketId: "new-socket",
      generation: 2,
    });
  });

  it("makes grace eviction a generation-checked atomic transition", async () => {
    await claim("channel");
    const joined = await join({
      channelId: "channel",
      socketId: "socket",
      newSessionId: "session",
    });
    const generation = joined.kind === "joined" ? joined.participant.generation : 0;
    await repository.disconnect("channel", "user", "socket", now());

    await expect(repository.beginEviction("channel", "user", generation)).resolves.toBe(true);
    await expect(
      join({
        channelId: "channel",
        socketId: "new-socket",
        newSessionId: "new-session",
        resumeSessionId: "session",
      }),
    ).resolves.toEqual({ kind: "evicting" });
    await expect(repository.finishEviction("channel", "user", generation)).resolves.toBe(true);
    await expect(repository.participant("channel", "user")).resolves.toBeNull();
  });

  it("keeps moderator state on resume but resets it for a new participation", async () => {
    await claim("channel");
    const joined = await join({
      channelId: "channel",
      socketId: "socket",
      newSessionId: "session",
    });
    if (joined.kind !== "joined") throw new Error("Expected a fresh voice participation");

    const moderated = await repository.updateModeratorState(
      "channel",
      "user",
      joined.participant.sessionId,
      joined.participant.generation,
      { moderatorMuted: false, moderatorDeafened: false },
      { moderatorMuted: true, moderatorDeafened: true },
    );
    expect(moderated).toMatchObject({ moderatorMuted: true, moderatorDeafened: true });

    await repository.disconnect("channel", "user", "socket", now());
    const resumed = await join({
      channelId: "channel",
      socketId: "resumed-socket",
      newSessionId: "unused",
      resumeSessionId: "session",
    });
    expect(resumed.kind === "resumed" ? resumed.participant : null).toMatchObject({
      moderatorMuted: true,
      moderatorDeafened: true,
    });

    if (resumed.kind !== "resumed") throw new Error("Expected the same voice participation");
    await repository.leave(
      "channel",
      "user",
      resumed.participant.sessionId,
      resumed.participant.generation,
    );
    const fresh = await join({
      channelId: "channel",
      socketId: "fresh-socket",
      newSessionId: "fresh-session",
    });
    expect(fresh.kind === "joined" ? fresh.participant : null).toMatchObject({
      moderatorMuted: false,
      moderatorDeafened: false,
    });
  });

  it("rejects a control update from an old participant generation", async () => {
    await claim("channel");
    const joined = await join({
      channelId: "channel",
      socketId: "socket",
      newSessionId: "session",
    });
    if (joined.kind !== "joined") throw new Error("Expected a fresh voice participation");

    await expect(
      repository.updateSelfState(
        "channel",
        "user",
        joined.participant.sessionId,
        joined.participant.generation + 1,
        { selfMuted: true, selfDeafened: false },
      ),
    ).resolves.toBeNull();
    await expect(
      repository.updateModeratorState(
        "channel",
        "user",
        joined.participant.sessionId,
        joined.participant.generation + 1,
        { moderatorMuted: false, moderatorDeafened: false },
        { moderatorMuted: true, moderatorDeafened: false },
      ),
    ).resolves.toBeNull();
  });

  it("keeps a self toggle from erasing a moderator mute written under it", async () => {
    await claim("channel");
    const joined = await join({
      channelId: "channel",
      socketId: "socket",
      newSessionId: "session",
    });
    if (joined.kind !== "joined") throw new Error("Expected a fresh voice participation");
    const { sessionId, generation } = joined.participant;

    // What a second instance would hold: the participant as it was before the moderation.
    const stale = joined.participant;
    await repository.updateModeratorState(
      "channel",
      "user",
      sessionId,
      generation,
      { moderatorMuted: false, moderatorDeafened: false },
      { moderatorMuted: true, moderatorDeafened: false },
    );

    const afterSelf = await repository.updateSelfState("channel", "user", sessionId, generation, {
      selfMuted: !stale.selfMuted,
      selfDeafened: stale.selfDeafened,
    });

    expect(afterSelf).toMatchObject({ selfMuted: true, moderatorMuted: true });
  });

  it("refuses a moderator write whose decision was made about flags that have since moved", async () => {
    await claim("channel");
    const joined = await join({
      channelId: "channel",
      socketId: "socket",
      newSessionId: "session",
    });
    if (joined.kind !== "joined") throw new Error("Expected a fresh voice participation");
    const { sessionId, generation } = joined.participant;

    await repository.updateModeratorState(
      "channel",
      "user",
      sessionId,
      generation,
      { moderatorMuted: false, moderatorDeafened: false },
      { moderatorMuted: true, moderatorDeafened: false },
    );

    // A second moderator authorised this while the flags still read false.
    await expect(
      repository.updateModeratorState(
        "channel",
        "user",
        sessionId,
        generation,
        { moderatorMuted: false, moderatorDeafened: false },
        { moderatorMuted: false, moderatorDeafened: true },
      ),
    ).resolves.toBeNull();
    await expect(repository.participant("channel", "user")).resolves.toMatchObject({
      moderatorMuted: true,
      moderatorDeafened: false,
    });
  });

  it("keeps all presence keys alive on heartbeat and removes only own orphaned rooms", async () => {
    await claim("own-channel", "own-instance");
    await join({
      channelId: "own-channel",
      socketId: "socket",
      newSessionId: "session",
    });
    await claim("foreign-channel", "foreign-instance");

    await expect(repository.touch("user")).resolves.toBe(true);
    await expect(redis.ttl("voice:user:user")).resolves.toBeGreaterThan(0);
    await expect(redis.ttl("voice:channel:own-channel")).resolves.toBeGreaterThan(0);
    await expect(redis.ttl("voice:channel:own-channel:meta")).resolves.toBeGreaterThan(0);

    await expect(repository.removeRoomsOwnedBy("own-instance")).resolves.toBe(1);
    await expect(redis.exists("voice:channel:own-channel")).resolves.toBe(0);
    await expect(redis.exists("voice:user:user")).resolves.toBe(0);
    await expect(redis.exists("voice:channel:foreign-channel:meta")).resolves.toBe(1);
  });

  it("enforces room capacity inside the atomic join transition", async () => {
    await claim("full-channel");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.join({
          channelId: "full-channel",
          userId: `user-${String(index)}`,
          authenticationSessionId: `auth-session-${String(index)}`,
          socketId: `socket-${String(index)}`,
          newSessionId: `session-${String(index)}`,
          now: now(),
        }),
      ),
    );

    await expect(
      repository.join({
        channelId: "full-channel",
        userId: "overflow-user",
        authenticationSessionId: "overflow-auth-session",
        socketId: "overflow-socket",
        newSessionId: "overflow-session",
        now: now(),
      }),
    ).resolves.toEqual({ kind: "full" });
    await expect(repository.participants("full-channel")).resolves.toHaveLength(20);
  });

  async function claim(channelId: string, instanceId = "instance"): Promise<void> {
    await repository.claimRoom(channelId, {
      instanceId,
      routerId: `router-${channelId}`,
      createdAt: now(),
    });
  }

  function join(input: {
    channelId: string;
    socketId: string;
    newSessionId: string;
    resumeSessionId?: string;
  }) {
    return repository.join({
      ...input,
      userId: "user",
      authenticationSessionId: "auth-session",
      now: now(),
    });
  }
});

function now(): string {
  return new Date().toISOString();
}
