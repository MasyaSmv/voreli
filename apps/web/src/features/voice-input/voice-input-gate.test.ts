import { describe, expect, it } from "vitest";

import { VoiceInputGate } from "./voice-input-gate";

describe("VoiceInputGate", () => {
  it("opens VAD immediately and closes after continuous 300 ms silence", () => {
    const gate = new VoiceInputGate();
    expect(gate.sample(-30, -35, true, 0)).toBe(true);
    expect(gate.sample(-50, -35, true, 100)).toBe(true);
    expect(gate.sample(-50, -35, true, 399)).toBe(true);
    expect(gate.sample(-50, -35, true, 400)).toBe(false);
  });

  it("ignores unrelated, repeated and editable PTT key events", () => {
    const gate = new VoiceInputGate();
    expect(gate.keyDown("Space", "KeyV", false, false, true)).toBe(false);
    expect(gate.keyDown("KeyV", "KeyV", true, false, true)).toBe(false);
    expect(gate.keyDown("KeyV", "KeyV", false, true, true)).toBe(false);
    expect(gate.keyDown("KeyV", "KeyV", false, false, true)).toBe(true);
    expect(gate.keyUp("KeyV", "KeyV")).toBe(true);
    expect(gate.open).toBe(false);
  });

  it("cannot open while a server or self mute applies and closes on lifecycle loss", () => {
    const gate = new VoiceInputGate();
    expect(gate.keyDown("KeyV", "KeyV", false, false, false)).toBe(false);
    gate.sample(-20, -35, true, 0);
    expect(gate.close()).toBe(false);
  });
});
