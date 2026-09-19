import type { ScreenShareView, VoiceParticipantView, VoiceProducerView } from "@voreli/shared";

import { useVoice } from "../../entities/voice/voice.store";
import { i18n } from "../../shared/i18n/i18n";

/**
 * The only place that writes the voice store, and the only truth about whether a session is
 * active.
 *
 * Both properties are deliberate. When the session, the socket listeners and the media layer
 * each wrote the store directly, the "back to idle" reset existed in three near-identical
 * copies; and the session kept private channelId/sessionId fields mirroring the store, which
 * is two truths that can only ever drift apart.
 */
export class VoiceSessionState {
  get channelId(): string | null {
    return useVoice.getState().channelId;
  }

  get sessionId(): string | null {
    return useVoice.getState().sessionId;
  }

  /** A session exists on the server: a reconnect should resume it rather than start over. */
  get isActive(): boolean {
    return this.channelId !== null && this.sessionId !== null;
  }

  get isConnected(): boolean {
    return useVoice.getState().connection === "connected";
  }

  participant(userId: string | undefined): VoiceParticipantView | undefined {
    if (userId === undefined) return undefined;
    return useVoice.getState().participants.find((current) => current.userId === userId);
  }

  joining(): void {
    useVoice.getState().replace({ connection: "joining", error: null });
  }

  joined(
    channelId: string,
    sessionId: string,
    participants: readonly VoiceParticipantView[],
    screenShares: readonly ScreenShareView[] = [],
  ): void {
    useVoice.getState().replace({ channelId, sessionId, participants, screenShares });
  }

  connected(): void {
    useVoice.getState().replace({ connection: "connected" });
  }

  reconnecting(): void {
    useVoice.getState().replace({ connection: "reconnecting" });
  }

  resumed(
    sessionId: string,
    participants: readonly VoiceParticipantView[],
    screenShares: readonly ScreenShareView[] = [],
  ): void {
    useVoice.getState().replace({ sessionId, participants, screenShares, connection: "connected" });
  }

  /**
   * `clearError` stays false on an involuntary drop: the reason the session ended is the one
   * thing the user still needs on screen.
   */
  idle(options: { readonly clearError: boolean } = { clearError: false }): void {
    useVoice.getState().replace({
      channelId: null,
      sessionId: null,
      connection: "idle",
      participants: [],
      speakingUserIds: new Set(),
      screenShares: [],
      selectedScreenShareId: null,
      screenAudioBlocked: false,
      ...(options.clearError ? { error: null } : {}),
    });
  }

  speaking(speakingUserIds: ReadonlySet<string>): void {
    useVoice.getState().replace({ speakingUserIds });
  }

  clearError(): void {
    useVoice.getState().replace({ error: null });
  }

  failed(error: unknown): void {
    useVoice.getState().replace({
      error: error instanceof Error ? error.message : i18n.t("voice.errors.connection"),
    });
  }

  upsertParticipant(participant: VoiceParticipantView): void {
    useVoice.getState().upsertParticipant(participant);
  }

  removeParticipant(userId: string): void {
    useVoice.getState().removeParticipant(userId);
  }

  addProducer(userId: string, producer: VoiceProducerView): void {
    const participant = this.participant(userId);
    if (!participant) return;
    if (participant.producers.some(({ producerId }) => producerId === producer.producerId)) return;
    useVoice.getState().upsertParticipant({
      ...participant,
      producers: [...participant.producers, producer],
    });
  }

  removeProducer(producerId: string): void {
    for (const participant of useVoice.getState().participants) {
      if (!participant.producers.some((producer) => producer.producerId === producerId)) continue;
      useVoice.getState().upsertParticipant({
        ...participant,
        producers: participant.producers.filter((producer) => producer.producerId !== producerId),
      });
    }
  }

  upsertScreenShare(screenShare: ScreenShareView): void {
    useVoice.getState().upsertScreenShare(screenShare);
  }

  removeScreenShare(screenStreamId: string): void {
    useVoice.getState().removeScreenShare(screenStreamId);
  }

  selectScreenShare(screenStreamId: string | null): void {
    useVoice
      .getState()
      .replace({ selectedScreenShareId: screenStreamId, screenAudioBlocked: false });
  }

  setScreenAudioBlocked(blocked: boolean): void {
    useVoice.getState().replace({ screenAudioBlocked: blocked });
  }
}
