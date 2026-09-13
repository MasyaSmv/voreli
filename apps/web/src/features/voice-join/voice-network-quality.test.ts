import { describe, expect, it } from "vitest";

import { classifyNetwork, VoiceQualitySmoother } from "./voice-network-quality";

describe("voice network quality", () => {
  it("classifies the loss and RTT boundaries", () => {
    expect(classifyNetwork({ loss: 0.01, rttMs: 299 })).toBe("good");
    expect(classifyNetwork({ loss: 0.02, rttMs: 100 })).toBe("constrained");
    expect(classifyNetwork({ loss: 0, rttMs: 300 })).toBe("constrained");
    expect(classifyNetwork({ loss: 0.05, rttMs: 100 })).toBe("poor");
    expect(classifyNetwork({ loss: 0, rttMs: 600 })).toBe("poor");
  });

  it("degrades after two samples and waits ten stable seconds before recovery", () => {
    const smoother = new VoiceQualitySmoother();
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 0)).toBe("good");
    expect(smoother.add({ loss: 0.06, rttMs: 700 }, 2_000)).toBeNull();
    expect(smoother.add({ loss: 0.06, rttMs: 700 }, 4_000)).toBe("poor");
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 6_000)).toBeNull();
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 14_000)).toBeNull();
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 16_000)).toBe("good");
  });

  it("resets a pending recovery when the network degrades again", () => {
    const smoother = new VoiceQualitySmoother();
    smoother.add({ loss: 0.06, rttMs: 700 }, 0);
    smoother.add({ loss: 0.01, rttMs: 100 }, 2_000);
    smoother.add({ loss: 0.06, rttMs: 700 }, 8_000);
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 10_000)).toBeNull();
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 18_000)).toBeNull();
    expect(smoother.add({ loss: 0.01, rttMs: 100 }, 20_000)).toBe("good");
  });
});
