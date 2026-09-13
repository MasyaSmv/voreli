import { CallServerEvent } from "@voreli/shared";
import { io } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import { useDirectCall } from "../../entities/direct-call/direct-call.store";
import { DirectCallSession } from "./direct-call-session";

describe("DirectCallSession socket ownership", () => {
  const socket = io("http://127.0.0.1:1/call", {
    autoConnect: false,
    reconnection: false,
    timeout: 1,
    transports: ["websocket"],
  });
  const session = new DirectCallSession(() => socket);

  afterEach(() => {
    session.reset();
    useDirectCall.getState().reset();
  });

  it("binds one handler set after reset and reconnect", () => {
    session.connect();
    expect(socket.listeners(CallServerEvent.Answered)).toHaveLength(1);
    expect(socket.listeners(CallServerEvent.Ended)).toHaveLength(1);

    session.reset();
    expect(socket.listeners(CallServerEvent.Answered)).toHaveLength(0);
    expect(socket.listeners(CallServerEvent.Ended)).toHaveLength(0);

    session.connect();
    expect(socket.listeners(CallServerEvent.Answered)).toHaveLength(1);
    expect(socket.listeners(CallServerEvent.Ended)).toHaveLength(1);
  });
});
