import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { InvalidPayloadError } from "../errors/invalid-payload.error.js";

/**
 * Validates a realtime payload inside the handler rather than through a pipe.
 *
 * A Socket.IO handler answers through an acknowledgement, and a pipe that throws never
 * reaches the body that would produce one: the caller waits for a reply that never comes.
 * Raising a domain error from inside the handler instead gives an invalid payload the same
 * typed acknowledgement as any other refusal.
 *
 * `class-transformer` is deliberately left without implicit conversion — a string `"false"`
 * that quietly became a boolean is exactly the coercion this is here to reject.
 */
export function validateSocketPayload<T extends object>(type: new () => T, payload: unknown): T {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InvalidPayloadError(["payload"]);
  }

  const instance = plainToInstance(type, payload, { enableImplicitConversion: false });
  const errors = validateSync(instance, { whitelist: true, forbidUnknownValues: true });

  if (errors.length > 0) {
    throw new InvalidPayloadError(errors.map((error) => error.property));
  }

  return instance;
}
