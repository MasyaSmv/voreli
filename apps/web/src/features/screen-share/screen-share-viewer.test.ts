import {
  type ScreenShareProducersResponse,
  type ScreenShareView,
  VoiceClientEvent,
} from "@voreli/shared";
import { afterEach, describe, expect, it } from "vitest";

import { useVoice } from "../../entities/voice/voice.store";
import type { VoiceSignaling } from "../voice-join/voice-signaling";
import { VoiceSessionState } from "../voice-join/voice-state";
import { ScreenShareViewer, type ScreenViewingMedia } from "./screen-share-viewer";

class TestSignaling implements VoiceSignaling {
  readonly connected = true;
  readonly requests: { event: string; payload: unknown }[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }

  request<T>(event: string, payload: unknown): Promise<T> {
    this.requests.push({ event, payload });
    if (event === VoiceClientEvent.ScreenWatch) {
      const response: ScreenShareProducersResponse = {
        producers: [
          {
            producerId: "screen-video-one",
            kind: "video",
            source: "screen-video",
            screenStreamId: "screen-one",
          },
        ],
      };
      return Promise.resolve(response as T);
    }
    return Promise.resolve(null as T);
  }

  on(): void {}
}

class RecordingMedia implements ScreenViewingMedia {
  watched: ScreenShareProducersResponse["producers"] = [];
  closes = 0;

  watchScreen(producers: ScreenShareProducersResponse["producers"]): Promise<boolean> {
    this.watched = producers;
    return Promise.resolve(true);
  }

  closeScreen(): void {
    this.closes += 1;
  }

  retainScreenProducers(): void {}

  attachScreenVideo(): Promise<void> {
    return Promise.resolve();
  }

  resumeScreenAudio(): Promise<void> {
    return Promise.resolve();
  }
}

const screenShare: ScreenShareView = {
  id: "screen-one",
  mediaRoomId: "channel-one",
  userId: "user-alice",
  videoProducerId: "screen-video-one",
  audioProducerId: null,
};

describe("ScreenShareViewer", () => {
  const state = new VoiceSessionState();

  afterEach(() => state.idle({ clearError: true }));

  it("asks for producers before consuming and releases the selected share explicitly", async () => {
    state.joined("channel-one", "session-one", []);
    const signaling = new TestSignaling();
    const media = new RecordingMedia();
    const viewer = new ScreenShareViewer(signaling, state, media);

    await viewer.watch(screenShare);

    expect(signaling.requests.map(({ event }) => event)).toEqual([
      VoiceClientEvent.ScreenWatch,
      VoiceClientEvent.ScreenLayer,
    ]);
    expect(media.watched).toHaveLength(1);
    expect(useVoice.getState().selectedScreenShareId).toBe(screenShare.id);

    await viewer.unwatch();

    expect(signaling.requests.at(-1)).toEqual({
      event: VoiceClientEvent.ScreenUnwatch,
      payload: { mediaRoomId: "channel-one", screenStreamId: screenShare.id },
    });
    expect(useVoice.getState().selectedScreenShareId).toBeNull();
    expect(media.closes).toBeGreaterThan(0);
  });
});
