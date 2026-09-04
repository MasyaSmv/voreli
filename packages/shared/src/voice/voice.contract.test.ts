import { describe, expect, it } from "vitest";

import { VOICE_NAMESPACE, VoiceClientEvent, VoiceServerEvent } from "./voice.contract.js";

describe("voice contract", () => {
  it("keeps voice signaling in its own namespace", () => {
    expect(VOICE_NAMESPACE).toBe("/voice");
  });

  it("uses unique event names within each direction", () => {
    expect(new Set(Object.values(VoiceClientEvent)).size).toBe(
      Object.keys(VoiceClientEvent).length,
    );
    expect(new Set(Object.values(VoiceServerEvent)).size).toBe(
      Object.keys(VoiceServerEvent).length,
    );
  });
});
