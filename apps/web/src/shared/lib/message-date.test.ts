import { describe, expect, it } from "vitest";

import { formatMessageDay, formatMessageTime, sameLocalDay } from "./message-date";

describe("message date formatting", () => {
  it("detects a calendar-day boundary", () => {
    expect(sameLocalDay("2026-09-08T08:00:00", "2026-09-08T23:59:00")).toBe(true);
    expect(sameLocalDay("2026-09-08T23:59:00", "2026-09-09T00:01:00")).toBe(false);
  });

  it("formats the day and time in the requested locale", () => {
    expect(formatMessageDay("2026-09-08T12:34:00", "ru-RU")).toContain("2026");
    expect(formatMessageTime("2026-09-08T12:34:00", "en-GB")).toMatch(/12:34/);
  });
});
