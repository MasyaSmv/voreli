import {
  type CreateConsumerResponse,
  VoiceClientEvent,
  type VoiceJoinResponse,
} from "@voreli/shared";
import type { types } from "mediasoup-client";

import type { OwnUserId } from "./voice-identity";
import { VoicePlayback } from "./voice-playback";
import { VoiceRequestError } from "./voice-request-error";
import type { VoiceSignaling } from "./voice-signaling";
import type { VoiceSessionState } from "./voice-state";
import { createVoiceTransports, type VoiceTransports } from "./voice-transports";

/** Opus settings for speech: DTX drops silence, FEC survives the loss that follows it. */
const MICROPHONE_CODEC_OPTIONS = {
  opusDtx: true,
  opusFec: true,
  opusMaxAverageBitrate: 40_000,
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

  /**
   * Builds the graph and starts consuming everyone already in the room. Returns the live
   * microphone track, or undefined for a member who may listen but not speak.
   */
  async build(
    joined: VoiceJoinResponse,
    stream: MediaStream,
    deafened: boolean,
  ): Promise<MediaStreamTrack | undefined> {
    this.deafened = deafened;
    // Imported on first join rather than at module scope so the SFU client does not weigh
    // down the initial page load for people who never open a voice channel.
    const { Device } = await import("mediasoup-client");
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });
    this.transports = await createVoiceTransports(this.device, this.signaling, (error: unknown) =>
      this.state.failed(error),
    );

    const track = await this.produce(stream);
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
    // The server starts every consumer paused so the first packets cannot arrive before the
    // element that plays them exists.
    await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, {
      consumerId: consumer.id,
    });
  }

  /** Loops the local microphone back through the SFU — the round trip that proves it works. */
  async startEcho(): Promise<void> {
    if (!this.producer) throw new Error("Микрофон ещё не готов");
    await this.consume(this.producer.id);
  }

  async resumeAudio(): Promise<void> {
    for (const consumerId of await this.playback.resume()) {
      await this.signaling.request<null>(VoiceClientEvent.ResumeConsumer, { consumerId });
    }
  }

  async setDeafened(deafened: boolean): Promise<void> {
    this.deafened = deafened;
    await this.playback.setDeafened(deafened);
  }

  setMuted(muted: boolean): void {
    if (muted) this.producer?.pause();
    else this.producer?.resume();
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
  }

  private async produce(stream: MediaStream): Promise<MediaStreamTrack | undefined> {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Микрофон не вернул аудиодорожку");
    if (!this.transports) throw new Error("Транспорты не созданы");
    try {
      this.producer = await this.transports.send.produce({
        track,
        codecOptions: { ...MICROPHONE_CODEC_OPTIONS },
        zeroRtpOnPause: true,
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
}
