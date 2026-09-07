import { describe, expect, it } from "vitest";

import { RemoteSpeakingHold } from "./remote-speaking-hold";

describe("RemoteSpeakingHold", () => {
  it("holds a speaker through a brief empty report", () => {
    const hold = new RemoteSpeakingHold();

    expect([...hold.report(["bob"], 100)]).toEqual(["bob"]);
    expect([...hold.report([], 399)]).toEqual(["bob"]);
    expect([...hold.expire(400)]).toEqual([]);
  });

  it("extends only speakers reported again", () => {
    const hold = new RemoteSpeakingHold();
    hold.report(["bob", "carol"], 0);
    hold.report(["bob"], 200);

    expect([...hold.expire(300)]).toEqual(["bob"]);
    expect(hold.nextExpiry()).toBe(500);
  });
});
