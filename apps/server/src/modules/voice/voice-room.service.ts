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
import { MediaRoomAccessService } from "./media-room-access.service.js";
import { SpeakingService } from "./speaking.service.js";
import { VoiceRoomNotifier } from "./voice-room-notifier.js";

@Injectable()
export class VoiceRoomService implements OnModuleInit, OnModuleDestroy {
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly sessionOwners = new Map<string, { userId: string; channelId: string }>();
  private readonly reconnectSources = new Map<string, Set<"socket" | "transport">>();
  private readonly instanceId: string;
  private readonly graceMs: number;
  private unsubscribeTransportFailure?: () => void;
  private unsubscribeTransportReconnect?: () => void;

  constructor(
    @Inject(VOICE_STATE_REPOSITORY) private readonly state: VoiceStateRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly routers: RouterRegistryService,
    private readonly media: MediaSessionRegistry,
    private readonly access: MediaRoomAccessService,
    private readonly notifier: VoiceRoomNotifier,
    private readonly speaking: SpeakingService,
  ) {
    this.instanceId = config.get("INSTANCE_ID", { infer: true });
    this.graceMs = config.get("VOICE_RECONNECT_GRACE", { infer: true }) * 1_000;
  }

  onModuleInit(): void {
    this.unsubscribeTransportFailure = this.media.onTransportFailure((sessionId) =>
      this.leaveSession(sessionId),
    );
    this.unsubscribeTransportReconnect = this.media.onTransportReconnect(
      (sessionId, reconnecting) =>
        this.setSessionReconnectSource(sessionId, "transport", reconnecting),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeTransportFailure?.();
    this.unsubscribeTransportReconnect?.();
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();
  }

  async join(
    userId: string,
    authenticationSessionId: string,
    socketId: string,
    channelId: string,
    resumeSessionId?: string,
  ): Promise<VoiceJoinResponse> {
    await this.access.assertConnect(userId, authenticationSessionId, channelId);
    const handle = await this.routers.acquire(channelId);
    let retained = false;

    try {
      const owner = await this.state.claimRoom(channelId, {
        instanceId: this.instanceId,
        routerId: handle.router.id,
        createdAt: this.clock.now().toISOString(),
      });

      if (owner !== this.instanceId) {
        throw new VoiceRoomOnAnotherInstanceError(owner);
      }

      const maxParticipants = this.access.maxParticipants(channelId);
      const result = await this.state.join({
        channelId,
        userId,
        authenticationSessionId,
        socketId,
        newSessionId: this.ids.generate(),
        ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
        now: this.clock.now().toISOString(),
        ...(maxParticipants === undefined ? {} : { maxParticipants }),
      });

      if (result.kind === "other-channel") {
        await this.leaveUser(userId);
        return this.join(userId, authenticationSessionId, socketId, channelId, resumeSessionId);
      }

      if (result.kind === "full") throw new VoiceChannelFullError();
      if (result.kind === "evicting") throw new VoiceSessionEvictingError();

      if (result.kind === "resumed") {
        this.cancelGrace(result.participant.sessionId);

        if (!this.media.has(result.participant.sessionId)) {
          await this.state.leave(
            channelId,
            userId,
            result.participant.sessionId,
            result.participant.generation,
          );
          return this.join(userId, authenticationSessionId, socketId, channelId);
        }
        this.sessionOwners.set(result.participant.sessionId, { userId, channelId });
      } else {
        if (result.displaced) {
          this.cancelGrace(result.displaced.sessionId);
          await this.closeOwnedMediaSession(channelId, result.displaced.sessionId);
          this.sessionOwners.delete(result.displaced.sessionId);
        }
        this.media.register(result.participant.sessionId, channelId, handle);
        this.sessionOwners.set(result.participant.sessionId, { userId, channelId });
        retained = true;
      }

      const participants = await this.views(channelId);
      const current = participants.find((participant) => participant.userId === userId);
      if (current) {
        if (result.kind === "resumed") {
          this.notifier.updated(channelId, current);
          await this.setReconnectSource(channelId, userId, "socket", false);
        } else {
          this.notifier.joined(channelId, current);
        }
      }

      return {
        sessionId: result.participant.sessionId,
        resumed: result.kind === "resumed",
        rtpCapabilities: handle.router.rtpCapabilities,
        participants,
      };
    } finally {
      if (!retained) this.routers.release(channelId);
    }
  }

  async leaveUser(userId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    await this.leaveFrom(channelId, userId);
  }

  async leaveAuthenticatedSession(userId: string, authenticationSessionId: string): Promise<void> {
    const channelId = await this.state.channelOf(userId);
    if (!channelId) return;
    const participant = await this.state.participant(channelId, userId);
    if (participant?.authenticationSessionId !== authenticationSessionId) return;
    await this.remove(channelId, participant);
  }

  async leaveFrom(channelId: string, userId: string): Promise<void> {
    const participant = await this.state.participant(channelId, userId);
    if (!participant) return;
    await this.remove(channelId, participant);
  }

  async cleanupLocalRoom(channelId: string): Promise<void> {
    const localSessions = [...this.sessionOwners.entries()].filter(
      ([, owner]) => owner.channelId === channelId,
    );
    for (const [sessionId, owner] of localSessions) {
      const participant = await this.state.participant(channelId, owner.userId);
      if (participant?.sessionId === sessionId) {
        await this.remove(channelId, participant);
      } else {
        await this.closeOwnedMediaSession(channelId, sessionId);
        this.sessionOwners.delete(sessionId);
      }
    }
  }

  localRoomIds(): readonly string[] {
    return [...new Set([...this.sessionOwners.values()].map((owner) => owner.channelId))];
  }

  async hasParticipants(channelId: string): Promise<boolean> {
    return (await this.state.participants(channelId)).length > 0;
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

    this.notifier.updated(channelId, this.view(participant));
    await this.setReconnectSource(channelId, userId, "socket", true);

    const timer = setTimeout(() => void this.evict(channelId, participant), this.graceMs);
    timer.unref();
    this.graceTimers.set(participant.sessionId, timer);
  }

  private async evict(channelId: string, participant: VoiceParticipantState): Promise<void> {
    this.graceTimers.delete(participant.sessionId);
    if (!(await this.state.beginEviction(channelId, participant.userId, participant.generation))) {
      return;
    }
    await this.closeOwnedMediaSession(channelId, participant.sessionId);
    this.sessionOwners.delete(participant.sessionId);
    if (await this.state.finishEviction(channelId, participant.userId, participant.generation)) {
      await this.notifier.left(channelId, participant.userId);
    }
  }

  private async leaveSession(sessionId: string): Promise<void> {
    const owner = this.sessionOwners.get(sessionId);
    if (!owner) return;
    const participant = await this.state.participant(owner.channelId, owner.userId);
    if (participant?.sessionId === sessionId) await this.remove(owner.channelId, participant);
  }

  private async remove(channelId: string, participant: VoiceParticipantState): Promise<void> {
    this.cancelGrace(participant.sessionId);
    await this.closeOwnedMediaSession(channelId, participant.sessionId);
    this.sessionOwners.delete(participant.sessionId);
    if (
      await this.state.leave(
        channelId,
        participant.userId,
        participant.sessionId,
        participant.generation,
      )
    ) {
      await this.notifier.left(channelId, participant.userId);
    }
  }

  private cancelGrace(sessionId: string): void {
    const timer = this.graceTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(sessionId);
  }

  private async closeOwnedMediaSession(channelId: string, sessionId: string): Promise<void> {
    const producers = this.media.closeSession(sessionId);
    if (producers === null) return;
    await Promise.all(
      producers.map((producer) => this.speaking.removeProducer(channelId, producer.producerId)),
    );
    this.reconnectSources.delete(
      this.reconnectKey(channelId, this.sessionOwners.get(sessionId)?.userId ?? ""),
    );
    this.routers.release(channelId);
  }

  private async setSessionReconnectSource(
    sessionId: string,
    source: "transport",
    reconnecting: boolean,
  ): Promise<void> {
    const owner = this.sessionOwners.get(sessionId);
    if (!owner) return;
    await this.setReconnectSource(owner.channelId, owner.userId, source, reconnecting);
  }

  private async setReconnectSource(
    channelId: string,
    userId: string,
    source: "socket" | "transport",
    reconnecting: boolean,
  ): Promise<void> {
    const key = this.reconnectKey(channelId, userId);
    const sources = this.reconnectSources.get(key) ?? new Set<"socket" | "transport">();
    const wasReconnecting = sources.size > 0;
    if (reconnecting) sources.add(source);
    else sources.delete(source);
    if (sources.size > 0) this.reconnectSources.set(key, sources);
    else this.reconnectSources.delete(key);
    const isReconnecting = sources.size > 0;
    if (wasReconnecting !== isReconnecting) {
      await this.notifier.reconnecting(channelId, userId, isReconnecting);
    }
  }

  private reconnectKey(channelId: string, userId: string): string {
    return `${channelId}\u0000${userId}`;
  }

  private async views(channelId: string): Promise<readonly VoiceParticipantView[]> {
    return (await this.state.participants(channelId)).map((participant) => this.view(participant));
  }

  private view(participant: VoiceParticipantState): VoiceParticipantView {
    return {
      userId: participant.userId,
      selfMuted: participant.selfMuted,
      selfDeafened: participant.selfDeafened,
      producers: this.media.has(participant.sessionId)
        ? this.media.producersOfSession(participant.sessionId)
        : [],
    };
  }
}
