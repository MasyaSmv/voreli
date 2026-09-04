import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RedisClientType } from "redis";

import type { EnvironmentVariables } from "../../config/env.validation.js";
import { RedisClientFactory } from "../../infra/redis/redis-client.factory.js";
import type {
  VoiceJoinInput,
  VoiceJoinResult,
  VoiceParticipantState,
  VoiceRoomMeta,
  VoiceStateRepository,
} from "./voice-state.repository.js";

const CLAIM_ROOM_SCRIPT = `
local owner = redis.call('HGET', KEYS[1], 'instanceId')
if owner and owner ~= ARGV[1] then return owner end
redis.call('HSET', KEYS[1], 'instanceId', ARGV[1], 'routerId', ARGV[2], 'createdAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return ARGV[1]
`;

const JOIN_SCRIPT = `
local currentChannel = redis.call('GET', KEYS[1])
if currentChannel and currentChannel ~= ARGV[2] then return {'OTHER', currentChannel} end

local serialized = redis.call('HGET', KEYS[2], ARGV[1])
local existing = nil
local generation = 1
if serialized then
  existing = cjson.decode(serialized)
  generation = existing.generation + 1
  if existing.evicting then return {'EVICTING'} end
end

if existing and ARGV[3] ~= '' and existing.sessionId == ARGV[3] and existing.socketId == cjson.null then
  existing.generation = generation
  existing.socketId = ARGV[4]
  existing.disconnectedAt = cjson.null
  local resumed = cjson.encode(existing)
  redis.call('HSET', KEYS[2], ARGV[1], resumed)
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[7])
  redis.call('EXPIRE', KEYS[2], ARGV[7])
  redis.call('EXPIRE', KEYS[3], ARGV[7])
  return {'RESUMED', resumed}
end

local participant = {
  userId = ARGV[1], sessionId = ARGV[5], generation = generation, socketId = ARGV[4],
  selfMuted = false, selfDeafened = false, moderatorMuted = false,
  joinedAt = ARGV[6], disconnectedAt = cjson.null
}
local joined = cjson.encode(participant)
redis.call('HSET', KEYS[2], ARGV[1], joined)
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[7])
redis.call('EXPIRE', KEYS[2], ARGV[7])
redis.call('EXPIRE', KEYS[3], ARGV[7])
return {'JOINED', joined, serialized or ''}
`;

const DISCONNECT_SCRIPT = `
local serialized = redis.call('HGET', KEYS[1], ARGV[1])
if not serialized then return '' end
local participant = cjson.decode(serialized)
if participant.socketId ~= ARGV[2] or participant.evicting then return '' end
participant.socketId = cjson.null
participant.disconnectedAt = ARGV[3]
local updated = cjson.encode(participant)
redis.call('HSET', KEYS[1], ARGV[1], updated)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[4])
return updated
`;

const BEGIN_EVICTION_SCRIPT = `
local serialized = redis.call('HGET', KEYS[1], ARGV[1])
if not serialized then return 0 end
local participant = cjson.decode(serialized)
if participant.generation ~= tonumber(ARGV[2]) or participant.socketId ~= cjson.null or participant.evicting then return 0 end
participant.evicting = true
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(participant))
return 1
`;

const REMOVE_SCRIPT = `
local serialized = redis.call('HGET', KEYS[1], ARGV[1])
if not serialized then return 0 end
local participant = cjson.decode(serialized)
if participant.sessionId ~= ARGV[2] or participant.generation ~= tonumber(ARGV[3]) then return 0 end
if ARGV[4] == 'evicting' and not participant.evicting then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
if redis.call('GET', KEYS[2]) == ARGV[5] then redis.call('DEL', KEYS[2]) end
return 1
`;

const TOUCH_SCRIPT = `
local channelId = redis.call('GET', KEYS[1])
if not channelId then return 0 end
local room = 'voice:channel:' .. channelId
local meta = room .. ':meta'
if redis.call('HEXISTS', room, ARGV[1]) == 0 then redis.call('DEL', KEYS[1]); return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('EXPIRE', room, ARGV[2])
redis.call('EXPIRE', meta, ARGV[2])
return 1
`;

const UPDATE_SELF_STATE_SCRIPT = `
local serialized = redis.call('HGET', KEYS[1], ARGV[1])
if not serialized then return '' end
local participant = cjson.decode(serialized)
if participant.sessionId ~= ARGV[2] or participant.evicting then return '' end
participant.selfMuted = ARGV[3] == '1'
participant.selfDeafened = ARGV[4] == '1'
local updated = cjson.encode(participant)
redis.call('HSET', KEYS[1], ARGV[1], updated)
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('EXPIRE', KEYS[3], ARGV[5])
return updated
`;

const CLEAN_ROOM_SCRIPT = `
if redis.call('HGET', KEYS[1], 'instanceId') ~= ARGV[1] then return 0 end
local users = redis.call('HKEYS', KEYS[2])
for _, userId in ipairs(users) do
  local user = 'voice:user:' .. userId
  if redis.call('GET', user) == ARGV[2] then redis.call('DEL', user) end
end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;

function roomKey(channelId: string): string {
  return `voice:channel:${channelId}`;
}

function metaKey(channelId: string): string {
  return `${roomKey(channelId)}:meta`;
}

function userKey(userId: string): string {
  return `voice:user:${userId}`;
}

function parseParticipant(serialized: string): VoiceParticipantState {
  const parsed = JSON.parse(serialized) as Record<string, unknown>;

  return {
    userId: String(parsed["userId"]),
    sessionId: String(parsed["sessionId"]),
    generation: Number(parsed["generation"]),
    socketId: typeof parsed["socketId"] === "string" ? parsed["socketId"] : null,
    selfMuted: parsed["selfMuted"] === true,
    selfDeafened: parsed["selfDeafened"] === true,
    moderatorMuted: parsed["moderatorMuted"] === true,
    joinedAt: String(parsed["joinedAt"]),
    disconnectedAt: typeof parsed["disconnectedAt"] === "string" ? parsed["disconnectedAt"] : null,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Redis voice-state script returned an invalid result");
  }

  return value;
}

@Injectable()
export class RedisVoiceStateRepository
  implements VoiceStateRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisVoiceStateRepository.name);
  private readonly redis: RedisClientType;
  private readonly ttlSeconds: number;

  constructor(clients: RedisClientFactory, config: ConfigService<EnvironmentVariables, true>) {
    this.redis = clients.create();
    this.ttlSeconds = config.get("VOICE_PRESENCE_TTL", { infer: true });
    this.redis.on("error", (error: Error) => {
      this.logger.error({ message: "Voice-state Redis connection error", error });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }

  async claimRoom(channelId: string, meta: VoiceRoomMeta): Promise<string> {
    const owner = await this.redis.eval(CLAIM_ROOM_SCRIPT, {
      keys: [metaKey(channelId), roomKey(channelId)],
      arguments: [meta.instanceId, meta.routerId, meta.createdAt, String(this.ttlSeconds)],
    });

    if (typeof owner !== "string") {
      throw new Error("Redis voice-state claim script returned an invalid owner");
    }

    return owner;
  }

  async join(input: VoiceJoinInput): Promise<VoiceJoinResult> {
    const result = stringArray(
      await this.redis.eval(JOIN_SCRIPT, {
        keys: [userKey(input.userId), roomKey(input.channelId), metaKey(input.channelId)],
        arguments: [
          input.userId,
          input.channelId,
          input.resumeSessionId ?? "",
          input.socketId,
          input.newSessionId,
          input.now,
          String(this.ttlSeconds),
        ],
      }),
    );

    if (result[0] === "OTHER") {
      return { kind: "other-channel", channelId: result[1] ?? "" };
    }

    if (result[0] === "EVICTING") {
      return { kind: "evicting" };
    }

    const participant = parseParticipant(result[1] ?? "");

    if (result[0] === "RESUMED") {
      return { kind: "resumed", participant };
    }

    return {
      kind: "joined",
      participant,
      displaced: result[2] ? parseParticipant(result[2]) : null,
    };
  }

  async participant(channelId: string, userId: string): Promise<VoiceParticipantState | null> {
    const serialized = await this.redis.hGet(roomKey(channelId), userId);
    return serialized ? parseParticipant(serialized) : null;
  }

  async participants(channelId: string): Promise<readonly VoiceParticipantState[]> {
    return Object.values(await this.redis.hGetAll(roomKey(channelId))).map(parseParticipant);
  }

  async disconnect(
    channelId: string,
    userId: string,
    socketId: string,
    disconnectedAt: string,
  ): Promise<VoiceParticipantState | null> {
    const result = await this.redis.eval(DISCONNECT_SCRIPT, {
      keys: [roomKey(channelId), userKey(userId), metaKey(channelId)],
      arguments: [userId, socketId, disconnectedAt, String(this.ttlSeconds)],
    });
    return typeof result === "string" && result.length > 0 ? parseParticipant(result) : null;
  }

  async beginEviction(channelId: string, userId: string, generation: number): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(BEGIN_EVICTION_SCRIPT, {
          keys: [roomKey(channelId)],
          arguments: [userId, String(generation)],
        }),
      ) === 1
    );
  }

  async finishEviction(channelId: string, userId: string, generation: number): Promise<boolean> {
    const participant = await this.participant(channelId, userId);

    if (!participant) {
      return false;
    }

    return this.remove(channelId, userId, participant.sessionId, generation, "evicting");
  }

  leave(
    channelId: string,
    userId: string,
    sessionId: string,
    generation: number,
  ): Promise<boolean> {
    return this.remove(channelId, userId, sessionId, generation, "leave");
  }

  async touch(userId: string): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(TOUCH_SCRIPT, {
          keys: [userKey(userId)],
          arguments: [userId, String(this.ttlSeconds)],
        }),
      ) === 1
    );
  }

  async updateSelfState(
    channelId: string,
    userId: string,
    sessionId: string,
    selfMuted: boolean,
    selfDeafened: boolean,
  ): Promise<VoiceParticipantState | null> {
    const result = await this.redis.eval(UPDATE_SELF_STATE_SCRIPT, {
      keys: [roomKey(channelId), userKey(userId), metaKey(channelId)],
      arguments: [
        userId,
        sessionId,
        selfMuted ? "1" : "0",
        selfDeafened ? "1" : "0",
        String(this.ttlSeconds),
      ],
    });
    return typeof result === "string" && result.length > 0 ? parseParticipant(result) : null;
  }

  async removeRoomsOwnedBy(instanceId: string): Promise<number> {
    let cursor = "0";
    let removed = 0;

    do {
      const page = await this.redis.scan(cursor, { MATCH: "voice:channel:*:meta", COUNT: 100 });
      cursor = page.cursor;

      for (const meta of page.keys) {
        const room = meta.slice(0, -":meta".length);
        const channelId = room.slice("voice:channel:".length);
        removed += Number(
          await this.redis.eval(CLEAN_ROOM_SCRIPT, {
            keys: [meta, room],
            arguments: [instanceId, channelId],
          }),
        );
      }
    } while (cursor !== "0");

    return removed;
  }

  private async remove(
    channelId: string,
    userId: string,
    sessionId: string,
    generation: number,
    mode: "leave" | "evicting",
  ): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(REMOVE_SCRIPT, {
          keys: [roomKey(channelId), userKey(userId)],
          arguments: [userId, sessionId, String(generation), mode, channelId],
        }),
      ) === 1
    );
  }
}
