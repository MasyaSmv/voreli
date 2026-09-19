import { type ScreenShareResponse, VoiceClientEvent } from "@voreli/shared";
import type { types } from "mediasoup-client";

import type { VoiceSignaling } from "../voice-join/voice-signaling";
import type { VoiceSessionState } from "../voice-join/voice-state";
import { ScreenCaptureSource } from "./screen-capture-source";

export interface ScreenPublishingMedia {
  produceScreen(
    track: MediaStreamTrack,
    source: "screen-video" | "screen-audio",
    screenStreamId: string,
  ): Promise<types.Producer>;
}

export class ScreenShareController {
  private videoProducer: types.Producer | null = null;
  private audioProducer: types.Producer | null = null;
  private screenStreamId: string | null = null;
  private capturePending = false;

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly state: VoiceSessionState,
    private readonly media: ScreenPublishingMedia,
    private readonly capture = new ScreenCaptureSource(),
  ) {}

  captureDisplay(): Promise<MediaStream> {
    if (this.capturePending || this.videoProducer) {
      return Promise.reject(new Error("A screen share is already starting"));
    }
    this.capturePending = true;
    return this.capture.capture().finally(() => {
      this.capturePending = false;
    });
  }

  async start(stream: MediaStream): Promise<void> {
    const mediaRoomId = this.state.channelId;
    const videoTrack = stream.getVideoTracks()[0];
    if (!mediaRoomId || !videoTrack) {
      this.capture.release();
      throw new Error("Display capture did not provide a video track");
    }

    const screenStreamId = crypto.randomUUID();
    try {
      this.videoProducer = await this.media.produceScreen(
        videoTrack,
        "screen-video",
        screenStreamId,
      );
      const audioTrack = stream.getAudioTracks()[0];
      this.audioProducer = audioTrack
        ? await this.media.produceScreen(audioTrack, "screen-audio", screenStreamId)
        : null;
      const response = await this.signaling.request<ScreenShareResponse>(
        VoiceClientEvent.ScreenStart,
        {
          mediaRoomId,
          videoProducerId: this.videoProducer.id,
          ...(this.audioProducer ? { audioProducerId: this.audioProducer.id } : {}),
        },
      );
      this.screenStreamId = response.screenShare.id;
      videoTrack.addEventListener("ended", () => void this.stop().catch(this.reportStopFailure), {
        once: true,
      });
      audioTrack?.addEventListener(
        "ended",
        () => void this.stopAudio().catch(this.reportAudioStopFailure),
        { once: true },
      );
    } catch (error: unknown) {
      if (mediaRoomId && this.signaling.connected && this.videoProducer) {
        try {
          await this.signaling.request<null>(VoiceClientEvent.ScreenAbort, {
            mediaRoomId,
            screenStreamId,
          });
        } catch (cleanupError: unknown) {
          console.error("Failed to abort a partial screen share", {
            error: cleanupError,
            screenStreamId,
          });
        }
      }
      this.closeLocal();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const mediaRoomId = this.state.channelId;
    const screenStreamId = this.screenStreamId;
    try {
      if (mediaRoomId && screenStreamId && this.signaling.connected) {
        await this.signaling.request<null>(VoiceClientEvent.ScreenStop, {
          mediaRoomId,
          screenStreamId,
        });
      }
    } finally {
      this.closeLocal();
    }
  }

  close(): void {
    this.closeLocal();
  }

  stopped(screenStreamId: string): void {
    if (this.screenStreamId === screenStreamId) this.closeLocal();
  }

  private closeLocal(): void {
    this.audioProducer?.close();
    this.videoProducer?.close();
    this.audioProducer = null;
    this.videoProducer = null;
    this.screenStreamId = null;
    this.capturePending = false;
    this.capture.release();
  }

  private readonly reportStopFailure = (error: unknown): void => {
    console.error("Failed to stop screen share after the display track ended", { error });
  };

  private async stopAudio(): Promise<void> {
    const mediaRoomId = this.state.channelId;
    const screenStreamId = this.screenStreamId;
    const producer = this.audioProducer;
    this.audioProducer = null;
    producer?.close();
    if (mediaRoomId && screenStreamId && this.signaling.connected) {
      await this.signaling.request<null>(VoiceClientEvent.ScreenAudioStop, {
        mediaRoomId,
        screenStreamId,
      });
    }
  }

  private readonly reportAudioStopFailure = (error: unknown): void => {
    console.error("Failed to stop ended screen-share audio", { error });
  };
}
