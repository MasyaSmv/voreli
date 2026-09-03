import { describe, expect, it } from "vitest";

import { NodeEnv, validateEnv } from "./env.validation.js";

describe("validateEnv", () => {
  it("falls back to development defaults when nothing is set", () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
  });

  it("coerces PORT from the string the environment always gives us", () => {
    expect(validateEnv({ PORT: "4000" }).PORT).toBe(4000);
  });

  it("rejects a port outside the valid range", () => {
    expect(() => validateEnv({ PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects an unknown NODE_ENV instead of guessing", () => {
    expect(() => validateEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
