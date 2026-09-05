import { afterEach, describe, expect, it } from "vitest";

import { useVoice } from "../../entities/voice/voice.store";
import { VoiceSpeakingMonitor } from "./voice-speaking-monitor";
import { VoiceSessionState } from "./voice-state";

const state = new VoiceSessionState();
const ownUserId = "user-alice";

function speakingUserIds(): readonly string[] {
  return [...useVoice.getState().speakingUserIds].sort();
}

// The Web Audio half of the monitor needs a real browser and is covered by the voice e2e;
// what is worth pinning here is the merge — whose bubble lights up, and when it stops.
describe("VoiceSpeakingMonitor", () => {
  afterEach(() => {
    state.idle({ clearError: true });
  });

  it("shows the speakers the server reports", () => {
    const monitor = new VoiceSpeakingMonitor(state, () => ownUserId);

    monitor.setRemote(["user-bob", "user-carol"]);

    expect(speakingUserIds()).toEqual(["user-bob", "user-carol"]);
  });

  // Your own bubble is driven by the local meter alone. The server names you a speaker too,
  // but its report arrives a round trip late and would keep the bubble lit after a mute, so
  // it is overruled for yourself and only for yourself.
  it("never takes the server's word about the local speaker", () => {
    const monitor = new VoiceSpeakingMonitor(state, () => ownUserId);

    monitor.setRemote([ownUserId, "user-bob"]);
    expect(speakingUserIds()).toEqual(["user-bob"]);

    monitor.muteLocal();
    expect(speakingUserIds()).toEqual(["user-bob"]);
  });

  it("reports the remote set unchanged while nobody is signed in", () => {
    const monitor = new VoiceSpeakingMonitor(state, () => undefined);

    monitor.setRemote(["user-bob"]);

    expect(speakingUserIds()).toEqual(["user-bob"]);
  });

  it("stops naming anyone once the session ends", () => {
    const monitor = new VoiceSpeakingMonitor(state, () => ownUserId);
    monitor.setRemote(["user-bob", "user-carol"]);

    monitor.stopMetering();
    monitor.setRemote([]);

    expect(speakingUserIds()).toEqual([]);
  });
});
