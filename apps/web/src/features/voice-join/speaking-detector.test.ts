import { describe, expect, it } from "vitest";

import { SpeakingDetector } from "./speaking-detector";

describe("SpeakingDetector", () => {
  it("ignores an isolated noise spike and requires sustained input", () => {
    const detector = new SpeakingDetector();

    expect(detector.sample(0.08, true, 0)).toBe(false);
    expect(detector.sample(0.005, true, 16)).toBe(false);
    expect(detector.sample(0.05, true, 32)).toBe(false);
    expect(detector.sample(0.05, true, 48)).toBe(false);
    expect(detector.sample(0.05, true, 64)).toBe(true);
  });

  it("keeps speaking through short pauses and closes after sustained silence", () => {
    const detector = speakingDetector();

    expect(detector.sample(0.01, true, 100)).toBe(true);
    expect(detector.sample(0.01, true, 399)).toBe(true);
    expect(detector.sample(0.01, true, 400)).toBe(false);
  });

  it("uses hysteresis and resets immediately when disabled", () => {
    const detector = speakingDetector();

    expect(detector.sample(0.02, true, 100)).toBe(true);
    expect(detector.sample(0.05, false, 110)).toBe(false);
    expect(detector.sample(0.05, true, 120)).toBe(false);
  });
});

function speakingDetector(): SpeakingDetector {
  const detector = new SpeakingDetector();
  detector.sample(0.05, true, 0);
  detector.sample(0.05, true, 16);
  detector.sample(0.05, true, 32);

  return detector;
}
