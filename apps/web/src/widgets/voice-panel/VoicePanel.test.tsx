import type { ChannelView, PublicUser } from "@voreli/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { VoicePanel } from "./VoicePanel";

const user: PublicUser = {
  id: "user-one",
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: "2026-09-05T00:00:00.000Z",
};

const channel: ChannelView = {
  id: "voice-one",
  categoryId: null,
  type: "VOICE",
  name: "Общий",
  topic: null,
  position: 0,
};

describe("VoicePanel", () => {
  afterEach(() => {
    useSession.setState({ user: null });
    useVoice.setState({
      channelId: null,
      sessionId: null,
      connection: "idle",
      participants: [],
      speakingUserIds: new Set(),
      error: null,
    });
  });

  it("shows participants and the effective local controls", () => {
    useSession.setState({ user });
    useVoice.setState({
      channelId: channel.id,
      sessionId: "session-one",
      connection: "connected",
      participants: [
        {
          userId: user.id,
          selfMuted: true,
          selfDeafened: false,
          producers: [],
        },
        {
          userId: "user-two",
          selfMuted: false,
          selfDeafened: false,
          producers: [{ producerId: "producer-two", kind: "audio" }],
        },
      ],
      speakingUserIds: new Set(["user-two"]),
    });

    render(<VoicePanel channel={channel} />);

    expect(screen.getByText("Вы · микрофон выключен")).toBeInTheDocument();
    expect(screen.getByText("Участник user-t")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Включить микрофон" })).toBeEnabled();
    expect(screen.getByText("Голос подключён")).toBeInTheDocument();
  });
});
