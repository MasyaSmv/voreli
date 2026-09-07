import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChannelView, ServerView } from "@voreli/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { useSession } from "../../entities/session/session.store";
import { ChannelSidebar } from "./ChannelSidebar";

const server: ServerView = {
  id: "s1",
  name: "Дом",
  iconUrl: null,
  isOwner: true,
  permissions: "7195",
  roles: [
    {
      id: "r1",
      name: "@everyone",
      color: 0,
      permissions: "7195",
      position: 0,
      isDefault: true,
    },
  ],
  categories: [{ id: "c1", name: "Общее", position: 0 }],
  channels: [
    { id: "ch1", categoryId: "c1", type: "TEXT", name: "основной", topic: null, position: 0 },
    { id: "ch2", categoryId: "c1", type: "VOICE", name: "Голосовой", topic: null, position: 1 },
    { id: "ch3", categoryId: null, type: "TEXT", name: "заметки", topic: null, position: 2 },
  ],
};

describe("ChannelSidebar", () => {
  beforeEach(() => {
    useSession.setState({
      user: {
        id: "u1",
        username: "maxim",
        displayName: "Максим",
        avatarUrl: null,
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    });
  });

  it("groups channels by category and puts the rest under a fallback heading", () => {
    render(
      <ChannelSidebar
        server={server}
        unread={[]}
        activeChannelId={null}
        onSelect={() => {}}
        onLogout={() => {}}
      />,
    );

    expect(screen.getByText("Общее")).toBeInTheDocument();
    expect(screen.getByText("Без категории")).toBeInTheDocument();
    expect(screen.getByText("основной")).toBeInTheDocument();
    expect(screen.getByText("заметки")).toBeInTheDocument();
  });

  it("shows an unread badge only for channels that are not open", () => {
    render(
      <ChannelSidebar
        server={server}
        unread={[
          { channelId: "ch1", count: 3 },
          { channelId: "ch3", count: 7 },
        ]}
        activeChannelId="ch1"
        onSelect={() => {}}
        onLogout={() => {}}
      />,
    );

    // ch1 is on screen, so its counter is meaningless — the reader is looking at it.
    expect(screen.queryByTestId("unread-ch1")).toBeNull();
    expect(screen.getByTestId("unread-ch3")).toHaveTextContent("7");
  });

  it("reports the channel a person clicked", async () => {
    const selected: ChannelView[] = [];

    render(
      <ChannelSidebar
        server={server}
        unread={[]}
        activeChannelId={null}
        onSelect={(channel) => selected.push(channel)}
        onLogout={() => {}}
      />,
    );

    await userEvent.click(screen.getByText("заметки"));

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("ch3");
  });

  it("does not render a category that has no channels the member can see", () => {
    const empty: ServerView = {
      ...server,
      categories: [...server.categories, { id: "c2", name: "Закрытая", position: 1 }],
    };

    render(
      <ChannelSidebar
        server={empty}
        unread={[]}
        activeChannelId={null}
        onSelect={() => {}}
        onLogout={() => {}}
      />,
    );

    // The server never sends invisible channels, so an empty category must not hint at them.
    expect(screen.queryByText("Закрытая")).toBeNull();
  });

  it("opens the real server menu for an owner", async () => {
    render(
      <ChannelSidebar
        server={server}
        unread={[]}
        activeChannelId={null}
        onSelect={() => {}}
        onLogout={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Меню сервера Дом" }));

    expect(screen.getByRole("button", { name: "Создать канал" })).toBeInTheDocument();
  });

  it("opens profile and language settings from the user dock", async () => {
    render(
      <ChannelSidebar
        server={server}
        unread={[]}
        activeChannelId={null}
        onSelect={() => {}}
        onLogout={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Открыть профиль и настройки" }));

    const settings = screen.getByRole("dialog");
    expect(within(settings).getByRole("heading", { name: "Настройки" })).toBeInTheDocument();
    expect(within(settings).getByText("@maxim")).toBeInTheDocument();
    expect(within(settings).getByRole("group", { name: "Язык" })).toBeInTheDocument();
  });
});
