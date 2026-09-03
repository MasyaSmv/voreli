import { describe, expect, it } from "vitest";

import { NodeEnv, validateEnv } from "./env.validation.js";

/** The two variables that have no default, because guessing either one is dangerous. */
const required = {
  DATABASE_URL: "postgresql://voreli:voreli@localhost:5432/voreli",
  JWT_SECRET: "a-secret-that-is-at-least-32-characters",
};

describe("validateEnv", () => {
  it("falls back to development defaults for everything optional", () => {
    const env = validateEnv({ ...required });

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.ACCESS_TOKEN_TTL).toBe(900);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it("coerces PORT from the string the environment always gives us", () => {
    expect(validateEnv({ ...required, PORT: "4000" }).PORT).toBe(4000);
  });

  it("rejects a port outside the valid range", () => {
    expect(() => validateEnv({ ...required, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects an unknown NODE_ENV instead of guessing", () => {
    expect(() => validateEnv({ ...required, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("refuses to start without a database url", () => {
    expect(() => validateEnv({ JWT_SECRET: required.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it("refuses a short signing secret rather than accepting a weak one", () => {
    expect(() => validateEnv({ ...required, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("reads COOKIE_SECURE=false as false, not as a non-empty string", () => {
    // Boolean("false") is true; a security flag must never be parsed that way.
    expect(validateEnv({ ...required, COOKIE_SECURE: "false" }).COOKIE_SECURE).toBe(false);
    expect(validateEnv({ ...required, COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
  });
});
