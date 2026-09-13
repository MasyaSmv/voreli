import { describe, expect, it } from "vitest";

import { formatCallDuration } from "./call-duration";

describe("formatCallDuration", () => {
  it("uses minutes below an hour and hours above it", () => {
    expect(formatCallDuration(72)).toBe("1:12");
    expect(formatCallDuration(4_350)).toBe("1:12:30");
  });
});
