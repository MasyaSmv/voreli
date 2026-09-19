import {
  type ScreenShareProducersResponse,
  type ScreenShareView,
  VoiceClientEvent,
} from "@voreli/shared";

import type { VoiceSignaling } from "../voice-join/voice-signaling";
import type { VoiceSessionState } from "../voice-join/voice-state";

export interface ScreenViewingMedia {
  watchScreen(producers: ScreenShareProducersResponse["producers"]): Promise<boolean>;
  closeScreen(): void;
  retainScreenProducers(producerIds: ReadonlySet<string>): void;
  attachScreenVideo(element: HTMLVideoElement | null): Promise<void>;
  resumeScreenAudio(): Promise<void>;
}

/** Serialised selection of one remote share; the SFU only sends media after watch succeeds. */
export class ScreenShareViewer {
  private selectedScreenStreamId: string | null = null;

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly state: VoiceSessionState,
    private readonly media: ScreenViewingMedia,
  ) {}

  async watch(screenShare: ScreenShareView): Promise<void> {
    if (this.selectedScreenStreamId === screenShare.id) return;
    await this.unwatch();
    const response = await this.signaling.request<ScreenShareProducersResponse>(
      VoiceClientEvent.ScreenWatch,
      { mediaRoomId: screenShare.mediaRoomId, screenStreamId: screenShare.id },
    );
    try {
      const audioStarted = await this.media.watchScreen(response.producers);
      this.selectedScreenStreamId = screenShare.id;
      this.state.selectScreenShare(screenShare.id);
      this.state.setScreenAudioBlocked(screenShare.audioProducerId !== null && !audioStarted);
      await this.setLayer(screenShare.mediaRoomId, screenShare.id, 1);
    } catch (error: unknown) {
      this.media.closeScreen();
      await this.requestUnwatch(screenShare.mediaRoomId, screenShare.id);
      throw error;
    }
  }

  async unwatch(): Promise<void> {
    const screenStreamId = this.selectedScreenStreamId;
    const mediaRoomId = this.state.channelId;
    this.selectedScreenStreamId = null;
    this.state.selectScreenShare(null);
    this.media.closeScreen();
    if (screenStreamId && mediaRoomId && this.signaling.connected) {
      await this.requestUnwatch(mediaRoomId, screenStreamId);
    }
  }

  stopped(screenStreamId: string): void {
    if (this.selectedScreenStreamId !== screenStreamId) return;
    this.selectedScreenStreamId = null;
    this.state.selectScreenShare(null);
    this.media.closeScreen();
  }

  updated(screenShare: ScreenShareView): void {
    if (this.selectedScreenStreamId !== screenShare.id) return;
    if (screenShare.audioProducerId === null) this.state.setScreenAudioBlocked(false);
    this.media.retainScreenProducers(
      new Set(
        [screenShare.videoProducerId, screenShare.audioProducerId].filter(
          (producerId): producerId is string => producerId !== null,
        ),
      ),
    );
  }

  attachVideo(element: HTMLVideoElement | null): Promise<void> {
    return this.media.attachScreenVideo(element);
  }

  setPreferredLayer(spatialLayer: 0 | 1 | 2): Promise<void> {
    const screenStreamId = this.selectedScreenStreamId;
    const mediaRoomId = this.state.channelId;
    return screenStreamId && mediaRoomId
      ? this.setLayer(mediaRoomId, screenStreamId, spatialLayer).then(() => undefined)
      : Promise.resolve();
  }

  setVisible(visible: boolean): Promise<void> {
    const screenStreamId = this.selectedScreenStreamId;
    const mediaRoomId = this.state.channelId;
    return screenStreamId && mediaRoomId
      ? this.signaling
          .request<null>(VoiceClientEvent.ScreenVisibility, {
            mediaRoomId,
            screenStreamId,
            visible,
          })
          .then(() => undefined)
      : Promise.resolve();
  }

  async resumeAudio(): Promise<void> {
    await this.media.resumeScreenAudio();
    this.state.setScreenAudioBlocked(false);
  }

  close(): void {
    this.selectedScreenStreamId = null;
    this.state.selectScreenShare(null);
    this.media.closeScreen();
  }

  private setLayer(
    mediaRoomId: string,
    screenStreamId: string,
    spatialLayer: 0 | 1 | 2,
  ): Promise<null> {
    return this.signaling.request<null>(VoiceClientEvent.ScreenLayer, {
      mediaRoomId,
      screenStreamId,
      spatialLayer,
    });
  }

  private requestUnwatch(mediaRoomId: string, screenStreamId: string): Promise<null> {
    return this.signaling.request<null>(VoiceClientEvent.ScreenUnwatch, {
      mediaRoomId,
      screenStreamId,
    });
  }
}
