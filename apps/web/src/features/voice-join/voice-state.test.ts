import type { VoiceParticipantView } from "@voreli/shared";
import { afterEach, describe, expect, it } from "vitest";

import { useVoice } from "../../entities/voice/voice.store";
import { VoiceSessionState } from "./voice-state";

const alice: VoiceParticipantView = {
  userId: "user-alice",
  selfMuted: false,
  selfDeafened: false,
  producers: [{ producerId: "producer-alice", kind: "audio" }],
};

const bob: VoiceParticipantView = {
  userId: "user-bob",
  selfMuted: false,
  selfDeafened: false,
  producers: [],
};

// The real zustand store, not a stand-in: these transitions exist to be the one description
// of what the UI sees, so a test against anything else would describe nothing.
const state = new VoiceSessionState();

describe("VoiceSessionState", () => {
  afterEach(() => {
    state.idle({ clearError: true });
  });

  it("reports a session as active only once the server has answered with a session id", () => {
    expect(state.isActive).toBe(false);

    state.joining();
    expect(state.isActive).toBe(false);

    state.joined("channel-one", "session-one", [alice]);
    expect(state.isActive).toBe(true);
  });

  it("keeps the failure on screen when the session ends involuntarily", () => {
    state.joined("channel-one", "session-one", [alice, bob]);
    state.failed(new Error("Нет права подключаться"));

    state.idle();

    expect(useVoice.getState().error).toBe("Нет права подключаться");
    expect(useVoice.getState().channelId).toBeNull();
    expect(useVoice.getState().participants).toEqual([]);
    expect(useVoice.getState().connection).toBe("idle");
  });

  it("clears the failure when the user leaves on purpose", () => {
    state.joined("channel-one", "session-one", [alice]);
    state.failed(new Error("Аудио заблокировано"));

    state.idle({ clearError: true });

    expect(useVoice.getState().error).toBeNull();
  });

  it("describes a non-Error rejection rather than showing nothing", () => {
    state.failed("оборвалось");

    expect(useVoice.getState().error).toBe("Ошибка голосового соединения");
  });

  it("adds a producer once, however often the event arrives", () => {
    state.joined("channel-one", "session-one", [bob]);

    state.addProducer(bob.userId, { producerId: "producer-bob", kind: "audio" });
    state.addProducer(bob.userId, { producerId: "producer-bob", kind: "audio" });

    expect(state.participant(bob.userId)?.producers).toEqual([
      { producerId: "producer-bob", kind: "audio" },
    ]);
  });

  it("ignores a producer for someone who is not in the room", () => {
    state.joined("channel-one", "session-one", [bob]);

    state.addProducer("user-ghost", { producerId: "producer-ghost", kind: "audio" });

    expect(useVoice.getState().participants).toEqual([bob]);
  });

  it("removes a closed producer without touching the participant", () => {
    state.joined("channel-one", "session-one", [alice, bob]);

    state.removeProducer("producer-alice");

    expect(state.participant(alice.userId)).toEqual({ ...alice, producers: [] });
    expect(useVoice.getState().participants).toHaveLength(2);
  });
});
