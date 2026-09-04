import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { VoiceJoinResponse, VoiceParticipantView } from "@voreli/shared";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import type { EnvironmentVariables } from "../../config/env.validation.js";
import { RouterRegistryService } from "../../media/router-registry.service.js";
import {
  VoiceChannelFullError,
  VoiceRoomOnAnotherInstanceError,
  VoiceSessionEvictingError,
} from "./errors/voice-room-errors.js";
import { MediaSessionRegistry } from "./media-session.registry.js";
import {
  VOICE_STATE_REPOSITORY,
  type VoiceParticipantState,
  type VoiceStateRepository,
} from "./voice-state.repository.js";
import { VoiceChannelAccessService } from "./voice-channel-access.service.js";

@Injectable()
export class VoiceRoomService implements OnModuleInit, OnModuleDestroy {
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly sessionOwners = new Map<string, { userId: string; channelId: string }>();
  private readonly instanceId: string;
  private readonly graceMs: number;
  private unsubscribeTransportFailure?: () => void;

  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly routers: RouterRegistryService,
    private readonly media: MediaSessionRegistry,
    private readonly access: VoiceChannelAccessService,
  ) {
    this.instanceId = config.get("INSTANCE_ID", { infer: true });
    this.graceMs = config.get("VOICE_RECONNECT_GRACE", { infer: true }) * 1_000;
  }

  onModuleInit(): void {
    this.unsubscribeTransportFailure = this.media.onTransportFailure((sessionId) =>
      this.leaveSession(sessionId),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeTransportFailure?.();
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();
  }

  async join(
    userId: string,
    socketId: string,
    channelId: string,
    resumeSessionId?: string,
  ): Promise<VoiceJoinResponse> {
    await this.access.assertConnect(userId, channelId);
    const handle = await this.routers.acquire(channelId);
    const owner = await this.state.claimRoom(channelId, {
      instanceId: this.instanceId,
      routerId: handle.router.id,
      createdAt: this.clock.now().toISOString(),
    });

    if (owner !== this.instanceId) {
      this.routers.release(channelId);
      throw new VoiceRoomOnAnotherInstanceError(owner);
    }

    const result = await this.state.join({
      channelId,
      userId,
      socketId,
      newSessionId: this.ids.generate(),
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      now: this.clock.now().toISOString(),
    });

    if (result.kind === "other-channel") {
      this.routers.release(channelId);
      await this.leaveUser(userId);
      return this.join(userId, socketId, channelId, resumeSessionId);
    }

    if (result.kind === "full") {
      this.routers.release(channelId);
      throw new VoiceChannelFullError();
    }

    if (result.kind === "evicting") {
      this.routers.release(channelId);
      throw new VoiceSessionEvictingError();
    }

    if (result.kind === "resumed") {
      this.routers.release(channelId);
      this.cancelGrace(result.participant.sessionId);

      if (!this.media.has(result.participant.sessionId)) {
        await this.state.leave(
          channelId,
          userId,
          result.participant.sessionId,
          result.participant.generation,
        );
        return this.join(userId, socketId, channelId);
      }
      this.sessionOwners.set(result.participant.sessionId, { userId, channelId });
    } else {
      if (result.displaced) {
        this.cancelGrace(result.displaced.sessionId);
        this.media.closeSession(result.displaced.sessionId);
        this.sessionOwners.delete(result.displaced.sessionId);
      }
      this.media.register(result.participant.sessionId, channelId, handle);
      this.sessionOwners.set(result.participant.sessionId, { userId, channelId });
    }

    return {
      sessionId: result.participant.sessionId,
      resumed: result.kind === "resumed",
      rtpCapabilities: handle.router.rtpCapabilities,
      participants: await this.views(channelId),
    };
  }

  async leaveUser(userId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    const participant = await this.state.participant(channelId, userId);
    if (!participant) return;
    await this.remove(channelId, participant);
  }

  async disconnect(userId: string, socketId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    const participant = await this.state.disconnect(
      channelId,
      userId,
      socketId,
      this.clock.now().toISOString(),
    );
    if (!participant) return;

    const timer = setTimeout(() => void this.evict(channelId, participant), this.graceMs);
    timer.unref();
    this.graceTimers.set(participant.sessionId, timer);
  }

  private async evict(channelId: string, participant: VoiceParticipantState): Promise<void> {
    this.graceTimers.delete(participant.sessionId);
    if (!(await this.state.beginEviction(channelId, participant.userId, participant.generation))) {
      return;
    }
    this.media.closeSession(participant.sessionId);
    this.sessionOwners.delete(participant.sessionId);
    await this.state.finishEviction(channelId, participant.userId, participant.generation);
    this.routers.release(channelId);
  }

  private async leaveSession(sessionId: string): Promise<void> {
    const owner = this.sessionOwners.get(sessionId);
    if (!owner) return;
    const participant = await this.state.participant(owner.channelId, owner.userId);
    if (participant?.sessionId === sessionId) await this.remove(owner.channelId, participant);
  }

  private async remove(channelId: string, participant: VoiceParticipantState): Promise<void> {
    this.cancelGrace(participant.sessionId);
    this.media.closeSession(participant.sessionId);
    this.sessionOwners.delete(participant.sessionId);
    if (
      await this.state.leave(
        channelId,
        participant.userId,
        participant.sessionId,
        participant.generation,
      )
    ) {
      this.routers.release(channelId);
    }
  }

  private cancelGrace(sessionId: string): void {
    const timer = this.graceTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(sessionId);
  }

  private async views(channelId: string): Promise<readonly VoiceParticipantView[]> {
    return (await this.state.participants(channelId)).map((participant) => ({
      userId: participant.userId,
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      producers: this.media.has(participant.sessionId)
        ? this.media.producersOfSession(participant.sessionId)
        : [],
    }));
  }
}
