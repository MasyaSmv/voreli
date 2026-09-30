import { describe, expect, it } from "vitest";
import { normalizeEmoji } from "./reaction.service.js";
import { previewText } from "./message-read-model.js";

describe("rich message text boundaries", () => {
  it("keeps complete graphemes in reply previews", () => {
    const family = "👩‍👩‍👧‍👦";
    expect(previewText(family.repeat(121))).toBe(family.repeat(120));
    expect(previewText("e\u0301".repeat(121))).toBe("e\u0301".repeat(120));
  });
  it("accepts composed emoji and rejects text, multiple emoji and bare keycap characters", () => {
    for (const emoji of ["👍", "👍🏽", "❤️", "👩‍👩‍👧‍👦", "🇷🇺", "1️⃣"])
      expect(normalizeEmoji(emoji)).toBe(emoji);
    for (const emoji of ["a", "1", "#", "", "👍👍", "🏽", "\u200d", "👍a"])
      expect(() => normalizeEmoji(emoji)).toThrow();
  });
});
