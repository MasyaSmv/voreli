import { describe, expect, it } from "vitest";

import { callIdFromMediaRoom, callMediaRoomId, decodeCallEventContent } from "./call.contract.js";

describe("call contract", () => {
  it("round-trips direct-call media room ids", () => {
    expect(callIdFromMediaRoom(callMediaRoomId("call-1"))).toBe("call-1");
    expect(callIdFromMediaRoom("channel-1")).toBeNull();
  });

  it("rejects malformed call history JSON without throwing", () => {
    expect(decodeCallEventContent(new TextEncoder().encode("{broken"))).toBeNull();
  });
});
