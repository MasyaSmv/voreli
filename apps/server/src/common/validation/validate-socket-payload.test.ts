import { describe, expect, it } from "vitest";

import {
  SetVoiceModeratorStateDto,
  SetVoiceSelfStateDto,
} from "../../modules/voice/dto/voice-control.dto.js";
import { InvalidPayloadError } from "../errors/invalid-payload.error.js";
import { validateSocketPayload } from "./validate-socket-payload.js";

describe("validateSocketPayload", () => {
  const moderatorCommand = {
    channelId: "channel",
    userId: "user",
    moderatorMuted: true,
    moderatorDeafened: false,
  };

  it("returns a typed instance for a well formed command", () => {
    const validated = validateSocketPayload(SetVoiceModeratorStateDto, moderatorCommand);

    expect(validated).toBeInstanceOf(SetVoiceModeratorStateDto);
    expect(validated).toMatchObject(moderatorCommand);
  });

  it("refuses a flag that only looks like a boolean instead of coercing it", () => {
    // "false" is truthy in JavaScript, so a coercing validator would turn a request to lift a
    // moderator mute into a request to apply one.
    expect(() =>
      validateSocketPayload(SetVoiceModeratorStateDto, {
        ...moderatorCommand,
        moderatorMuted: "false",
      }),
    ).toThrow(InvalidPayloadError);
  });

  it("names every property that failed", () => {
    try {
      validateSocketPayload(SetVoiceModeratorStateDto, {
        channelId: "",
        userId: 7,
        moderatorMuted: null,
        moderatorDeafened: false,
      });
      expect.unreachable("Expected the invalid command to be refused");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidPayloadError);
      expect((error as InvalidPayloadError).properties).toEqual(
        expect.arrayContaining(["channelId", "userId", "moderatorMuted"]),
      );
    }
  });

  it("refuses a command with a missing field", () => {
    expect(() => validateSocketPayload(SetVoiceSelfStateDto, { selfMuted: true })).toThrow(
      InvalidPayloadError,
    );
  });
});
