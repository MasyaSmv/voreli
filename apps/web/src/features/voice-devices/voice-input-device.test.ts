import { describe, expect, it } from "vitest";

import { matchesRequestedDevice } from "./voice-input-device";

describe("matchesRequestedDevice", () => {
  it("reuses a capture only when it came from the requested device", () => {
    expect(matchesRequestedDevice("microphone-a", "microphone-a")).toBe(true);
    expect(matchesRequestedDevice("microphone-a", "microphone-b")).toBe(false);
  });

  it("treats the absent setting and an unset choice as the same system default", () => {
    expect(matchesRequestedDevice(undefined, null)).toBe(true);
    expect(matchesRequestedDevice("default", null)).toBe(true);
    expect(matchesRequestedDevice(undefined, "default")).toBe(true);
  });

  it("does not reuse a named device when the system default was asked for", () => {
    expect(matchesRequestedDevice("microphone-a", null)).toBe(false);
    expect(matchesRequestedDevice("microphone-a", "default")).toBe(false);
  });
});
