import { VoiceClientEvent, type VoiceJoinResponse } from "@voreli/shared";

import { sessionUserId } from "./voice-identity";
import type { VoiceMedia } from "./voice-media";
import type { VoiceSignaling } from "./voice-signaling";
import type { VoiceSpeakingMonitor } from "./voice-speaking-monitor";
import type { VoiceSessionState } from "./voice-state";

/**
 * Establishes, re-establishes and tears down the connection to a voice channel.
 *
 * Kept apart from VoiceSession so that the commands the UI issues on a live session — mute,
 * deafen, echo — do not share a file with the considerably harder question of how a session
 * comes to exist and what has to be undone when it fails halfway.
 *
 * Nothing here serialises anything: the caller owns the queue, and every method assumes it is
 * the only transition running.
 */
export class VoiceConnection {
  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly state: VoiceSessionState,
    private readonly media: VoiceMedia,
    private readonly speaking: VoiceSpeakingMonitor,
  ) {}

  /**
   * The microphone arrives as a promise because it is requested before the join round trip,
   * so the permission prompt and the server's work overlap.
   */
  async join(channelId: string, microphone: Promise<MediaStream>): Promise<void> {
    if (this.state.channelId === channelId && this.state.isConnected) {
      (await microphone).getTracks().forEach((track) => track.stop());
      return;
    }

    let stream: MediaStream | undefined;
    let joinedServer = false;

    try {
      this.state.joining();
      await this.signaling.connect();

      // Switching channels: the old session has to be given up before the new one is claimed,
      // or the server counts the same user in two rooms.
      if (this.state.channelId !== null) {
        await this.signaling.request<null>(VoiceClientEvent.Leave, {});
        this.closeMedia();
      }

      const joined = await this.signaling.request<VoiceJoinResponse>(VoiceClientEvent.Join, {
        channelId,
      });
      joinedServer = true;
      this.state.joined(channelId, joined.sessionId, joined.participants);

      stream = await microphone;
      await this.buildMedia(joined, stream);
      this.state.connected();
    } catch (error: unknown) {
      await this.abort(microphone, stream, joinedServer);
      throw error;
    }
  }

  /**
   * Rejoins after the socket came back. The server holds the session for a grace period, so
   * `resumed` says whether the media it still owns is ours to keep using.
   */
  async resume(): Promise<void> {
    const { channelId, sessionId } = this.state;
    if (channelId === null || sessionId === null) return;

    const joined = await this.signaling.request<VoiceJoinResponse>(VoiceClientEvent.Join, {
      channelId,
      sessionId,
    });
    this.state.resumed(joined.sessionId, joined.participants);

    if (!joined.resumed) {
      this.closeMedia();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.buildMedia(joined, stream);
    }
  }

  /**
   * `clearError` is false on an involuntary drop: the reason the session ended is exactly
   * what the user still needs to see.
   */
  shutdown(options: { readonly clearError: boolean } = { clearError: false }): void {
    this.media.close();
    this.speaking.closeAudio();
    this.state.idle(options);
  }

  private async buildMedia(joined: VoiceJoinResponse, stream: MediaStream): Promise<void> {
    const deafened = this.state.participant(sessionUserId())?.selfDeafened ?? false;
    const track = await this.media.build(joined, stream, deafened);
    if (track) this.speaking.observeMicrophone(track, () => !this.media.microphonePaused);
  }

  private closeMedia(): void {
    this.media.close();
    this.speaking.stopMetering();
  }

  private async abort(
    microphone: Promise<MediaStream>,
    captured: MediaStream | undefined,
    joinedServer: boolean,
  ): Promise<void> {
    // The microphone may still be arriving. It has to be stopped either way, or the browser
    // keeps showing the recording indicator for a join that never completed.
    const stream =
      captured ??
      (await microphone.then(
        (late) => late,
        (microphoneError: unknown) => {
          this.state.failed(microphoneError);
          return undefined;
        },
      ));
    stream?.getTracks().forEach((track) => track.stop());

    if (joinedServer && this.signaling.connected) {
      try {
        await this.signaling.request<null>(VoiceClientEvent.Leave, {});
      } catch (cleanupError: unknown) {
        this.state.failed(cleanupError);
      }
    }
    this.shutdown();
  }
}
