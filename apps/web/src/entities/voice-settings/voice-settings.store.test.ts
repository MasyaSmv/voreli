import { describe, expect, it } from "vitest";

import { DEFAULT_VOICE_SETTINGS, parseVoiceSettings } from "./voice-settings.store";

describe("voice settings persistence", () => {
  it("accepts the local device settings contract", () => {
    expect(
      parseVoiceSettings(
        JSON.stringify({
          inputDeviceId: "microphone",
          outputDeviceId: "headphones",
          inputMode: "push-to-talk",
          voiceActivityThresholdDb: -42,
          pushToTalkCode: "Space",
          unknown: "discarded",
        }),
      ),
    ).toEqual({
      inputDeviceId: "microphone",
      outputDeviceId: "headphones",
      inputMode: "push-to-talk",
      voiceActivityThresholdDb: -42,
      pushToTalkCode: "Space",
    });
  });

  it("replaces invalid persisted fields with safe defaults", () => {
    expect(
      parseVoiceSettings(
        JSON.stringify({
          inputDeviceId: 42,
          outputDeviceId: "",
          inputMode: "always-on",
          voiceActivityThresholdDb: -90,
          pushToTalkCode: "",
        }),
      ),
    ).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseVoiceSettings("broken json")).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});
