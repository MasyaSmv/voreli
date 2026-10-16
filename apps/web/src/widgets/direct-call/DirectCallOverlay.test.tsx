import type { DirectCallView, PublicUser } from "@voreli/shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DirectCallState } from "../../features/direct-call/direct-call-state";
import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { DirectCallOverlay } from "./DirectCallOverlay";

const alice: PublicUser = {
  id: "alice-id",
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: "2026-09-09T00:00:00.000Z",
};
const bob: PublicUser = {
  id: "bob-id",
  username: "bob",
  displayName: "Bob",
  avatarUrl: null,
  createdAt: "2026-09-09T00:00:00.000Z",
};

function call(status: DirectCallView["status"]): DirectCallView {
  return {
    id: "call-id",
    conversationId: "conversation-id",
    caller: alice,
    callee: bob,
    status,
    createdAt: "2026-09-09T00:00:00.000Z",
    answeredAt: status === "ACTIVE" ? "2026-09-09T00:00:01.000Z" : null,
    endedAt: null,
    endedById: null,
  };
}

describe("DirectCallOverlay", () => {
  const state = new DirectCallState();

  afterEach(() => {
    useSession.setState({ user: null });
    state.reset();
    useVoice.setState({ participants: [], connection: "idle" });
  });

  it("shows accept and decline only to the callee and focuses decline", async () => {
    useSession.setState({ user: bob });
    state.pending(call("RINGING"));
    render(<DirectCallOverlay />);

    expect(screen.getByText("Входящий звонок")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Принять звонок" })).toBeEnabled();
    const decline = screen.getByRole("button", { name: "Отклонить звонок" });
    expect(decline).toBeEnabled();
    expect(screen.getByRole("dialog", { name: "Звонок с Alice" })).toHaveClass("h-dvh");
    await waitFor(() => expect(decline).toHaveFocus());
  });

  it("shows microphone, audio and hangup controls during an active call", () => {
    useSession.setState({ user: alice });
    state.activated(call("ACTIVE"), "direct-call:call-id");
    useVoice.setState({
      connection: "connected",
      participants: [
        {
          userId: alice.id,
          selfMuted: false,
          selfDeafened: false,
          moderatorMuted: false,
          moderatorDeafened: false,
          producers: [],
        },
      ],
    });
    render(<DirectCallOverlay />);

    expect(screen.getByText("Разговор идёт")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выключить микрофон" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Выключить звук" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Завершить звонок" })).toBeEnabled();
  });

  it("shows only degraded peer quality", async () => {
    useSession.setState({ user: alice });
    state.activated(call("ACTIVE"), "direct-call:call-id");
    state.qualityChanged("good");
    render(<DirectCallOverlay />);
    expect(screen.queryByText(/связь/i)).not.toBeInTheDocument();

    act(() => state.qualityChanged("poor"));
    await waitFor(() => expect(screen.getByText("У собеседника плохая связь")).toBeInTheDocument());
  });
});
