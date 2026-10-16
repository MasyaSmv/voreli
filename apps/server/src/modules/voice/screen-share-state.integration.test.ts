import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { ScreenShareStateService } from "./screen-share-state.service.js";

describe("screen share owner state", () => {
  it("moves one share from pending through active to stopped", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ScreenShareStateService],
    }).compile();
    const state = moduleRef.get(ScreenShareStateService);
    state.begin({
      id: "screen-one",
      mediaRoomId: "room-one",
      userId: "user-one",
      sessionId: "session-one",
      videoProducerId: null,
      audioProducerId: null,
    });
    state.recordProducer("session-one", "video-one", "screen-video");
    state.recordProducer("session-one", "audio-one", "screen-audio");
    expect(state.pending("session-one")?.audioProducerId).toBe("audio-one");
    state.activate({
      id: "screen-one",
      mediaRoomId: "room-one",
      userId: "user-one",
      sessionId: "session-one",
      videoProducerId: "video-one",
      audioProducerId: "audio-one",
    });
    expect(state.pending("session-one")).toBeUndefined();
    expect(state.activeForSession("session-one")?.id).toBe("screen-one");
    const updated = state.updateAudio(state.active("screen-one")!);
    expect(updated.audioProducerId).toBeNull();
    state.startStopping("screen-one");
    state.removeActive("screen-one");
    expect(state.isStopping("screen-one")).toBe(true);
    state.stopStopping("screen-one");
    expect(state.active("screen-one")).toBeUndefined();
    await moduleRef.close();
  });
});
