import { describe, expect, it } from "vitest";

import { isHealthResponse } from "./health.contract.js";

describe("isHealthResponse", () => {
  it("accepts a well-formed payload", () => {
    expect(isHealthResponse({ status: "ok", uptime: 12.5, version: "0.1.0" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["a wrong status", { status: "down", uptime: 1, version: "0.1.0" }],
    ["a string uptime", { status: "ok", uptime: "1", version: "0.1.0" }],
    ["a non-finite uptime", { status: "ok", uptime: Number.NaN, version: "0.1.0" }],
    ["a missing version", { status: "ok", uptime: 1 }],
  ])("rejects %s", (_label, payload) => {
    expect(isHealthResponse(payload)).toBe(false);
  });
});
