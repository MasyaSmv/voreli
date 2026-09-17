import {
  type CreateConsumerResponse,
  VoiceClientEvent,
  type VoiceJoinResponse,
  type VoiceParticipantView,
} from "@voreli/shared";
import type { types } from "mediasoup-client";

import { i18n } from "../../shared/i18n/i18n";
import type { OwnUserId } from "./voice-identity";
import { observeProducerQuality } from "./voice-network-quality";
import { VoicePlayback } from "./voice-playback";
import { VoiceRequestError } from "./voice-request-error";
import type { VoiceSignaling } from "./voice-signaling";
import type { VoiceSessionState } from "./voice-state";
import { createVoiceTransports, type VoiceTransports } from "./voice-transports";

/** Opus settings for speech: DTX drops silence, FEC survives the loss that follows it. */
const MICROPHONE_CODEC_OPTIONS = {
  opusDtx: true,
  opusFec: true,
  opusMaxAverageBitrate: 24_000,
  opusPtime: 20,
  opusNack: true,
} as const;

/**
 * Owns the browser half of the mediasoup graph for one joined session: the device, the
 * transport pair and the local producer. Remote audio elements live in VoicePlayback.
 *
 * Deafened state is kept here rather than read back out of the store, because a consumer
 * created by an incoming producer event needs the current value at a moment when nothing else
 * is on the call stack to pass it in.
 */
export class VoiceMedia {
  private device: types.Device | undefined;
  private transports: VoiceTransports | undefined;
  private producer: types.Producer | undefined;
  private deafened = false;
  private serverPaused = false;
  private inputGateOpen = false;
  private networkQuality: "good" | "constrained" | "poor" | "unknown" = "unknown";
  private readonly playback = new VoicePlayback();

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly state: VoiceSessionState,
    private readonly ownUserId: OwnUserId,
  ) {}

  /** True while nothing is being sent, including before the producer exists at all. */
  get microphonePaused(): boolean {
    return this.producer?.paused ?? true;
  }

  get microphoneServerPaused(): boolean {
    return this.serverPaused;
  }

  get outputSelectionSupported(): boolean {
    return this.playback.outputSelectionSupported;
  }

  /**
   * Builds the graph and starts consuming everyone already in the room. Returns the live
   * microphone track, or undefined for a member who may listen but not speak.
   */
  async build(
    joined: VoiceJoinResponse,
    stream: MediaStream,
    own: VoiceParticipantView | undefined,
  ): Promise<MediaStreamTrack | undefined> {
    this.serverPaused = own ? own.selfMuted || own.moderatorMuted : false;
    this.deafened = own ? own.selfDeafened || own.moderatorDeafened : false;
    // Imported on first join rather than at module scope so the SFU client does not weigh
    // down the initial page load for people who never open a voice channel.
    const { Device } = await import("mediasoup-client");
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });
    this.transports = await createVoiceTransports(this.device, this.signaling, (error: unknown) =>
      this.state.failed(error),
    );

    const track = await this.produce(stream);
    this.applyProducerPause();
    await Promise.all(
      joined.participants.flatMap((participant) =>
        participant.userId === this.ownUserId()
          ? []
          : participant.producers.map((producer) => this.consume(producer.producerId)),
      ),
    );
    return track;
  }

  /** Consumes a producer that belongs to someone else; own audio is only consumed by echo. */
  async consumeRemote(userId: string, producerId: string): Promise<void> {
    if (userId === this.ownUserId()) return;
    await this.consume(producerId);
  }

  async consume(producerId: string): Promise<void> {
    const recv = this.transports?.recv;
    if (!this.device || !recv || this.playback.has(producerId)) return;
    const response = await this.signaling.request<CreateConsumerResponse>(
      VoiceClientEvent.CreateConsumer,
      { transportId: recv.id, producerId, rtpCapabilities: this.device.rtpCapabilities },
    );
    const consumer = await recv.consume({
      id: response.consumerId,
      producerId: response.producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters,
    });
    await this.playback.add(producerId, consumer, this.deafened);
    this.playback.setJitterBufferTarget(
      this.networkQuality === "constrained" || this.networkQuality === "poor" ? 200 : null,
    );
    // The server starts every consumer paused so the first packets cannot arrive before the
    // element that plays them exists.
    await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, {
      consumerId: consumer.id,
    });
  }

  /** Loops the local microphone back through the SFU — the round trip that proves it works. */
  async startEcho(): Promise<void> {
    if (!this.producer) throw new Error(i18n.t("voice.errors.microphoneNotReady"));
    await this.consume(this.producer.id);
  }

  /**
   * Each consumer is played and reported as one step. A stream whose playback the browser
   * refuses must not take down the ones that already started: they are audible, and the
   * server has to be told so it stops holding them paused.
   */
  async resumeAudio(): Promise<void> {
    for await (const consumerId of this.playback.resume()) {
      await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, { consumerId });
    }
  }

  chooseOutput(preferredDeviceId: string | null): Promise<string | null> {
    return this.playback.chooseOutput(preferredDeviceId);
  }

  useDefaultOutput(): Promise<void> {
    return this.playback.useDefaultOutput();
  }

  async setDeafened(deafened: boolean): Promise<void> {
    this.deafened = deafened;
    await this.playback.setDeafened(deafened);
  }

  setMuted(muted: boolean): void {
    this.serverPaused = muted;
    this.applyProducerPause();
  }

  setInputGateOpen(open: boolean): void {
    this.inputGateOpen = open;
    this.applyProducerPause();
  }

  async setParticipantState(participant: VoiceParticipantView): Promise<void> {
    if (participant.userId !== this.ownUserId()) return;
    this.setMuted(participant.selfMuted || participant.moderatorMuted);
    await this.setDeafened(participant.selfDeafened || participant.moderatorDeafened);
  }

  observeQuality(
    onQuality: (quality: "good" | "constrained" | "poor" | "unknown") => void,
  ): () => void {
    return this.producer ? observeProducerQuality(this.producer, onQuality) : () => undefined;
  }

  setJitterBufferTarget(quality: "good" | "constrained" | "poor" | "unknown"): void {
    this.networkQuality = quality;
    this.playback.setJitterBufferTarget(
      quality === "constrained" || quality === "poor" ? 200 : null,
    );
  }

  closeProducer(producerId: string): void {
    if (this.producer?.id !== producerId) return;
    this.producer.close();
    this.producer = undefined;
  }

  closeReceived(producerId: string): void {
    this.playback.close(producerId);
  }

  close(): void {
    this.producer?.close();
    this.transports?.send.close();
    this.transports?.recv.close();
    this.playback.closeAll();
    this.producer = undefined;
    this.transports = undefined;
    this.device = undefined;
    this.networkQuality = "unknown";
    this.serverPaused = false;
    this.inputGateOpen = false;
  }

  private async produce(stream: MediaStream): Promise<MediaStreamTrack | undefined> {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error(i18n.t("voice.errors.missingAudioTrack"));
    if (!this.transports) throw new Error(i18n.t("voice.errors.transportsNotReady"));
    try {
      this.producer = await this.transports.send.produce({
        track,
        codecOptions: { ...MICROPHONE_CODEC_OPTIONS },
        zeroRtpOnPause: true,
        disableTrackOnPause: false,
        stopTracks: false,
      });
      return track;
    } catch (error: unknown) {
      track.stop();
      // A listener without the speak permission is a valid participant, not a failed join.
      if (error instanceof VoiceRequestError && error.errorCode === "VOICE_SPEAK_FORBIDDEN") {
        return undefined;
      }
      throw error;
    }
  }

  async replaceInputTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.producer) throw new Error(i18n.t("voice.errors.microphoneNotReady"));
    await this.producer.replaceTrack({ track });
    this.applyProducerPause();
  }

  private applyProducerPause(): void {
    if (this.serverPaused || !this.inputGateOpen) this.producer?.pause();
    else this.producer?.resume();
  }
}
