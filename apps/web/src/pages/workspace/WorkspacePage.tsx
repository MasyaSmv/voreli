import { useQuery } from "@tanstack/react-query";
import type { ChannelView } from "@voreli/shared";
import { useState } from "react";

import { useSession } from "../../entities/session/session.store";
import { fetchMyServers, fetchServer, fetchUnread } from "../../entities/server/server.api";
import { ChannelSidebar } from "../../widgets/channel-sidebar/ChannelSidebar";
import { ChatPanel } from "../../widgets/chat/ChatPanel";

/** The main screen: servers on the left, channels next to them, the conversation filling the rest. */
export function WorkspacePage() {
  const user = useSession((state) => state.user);
  const logOut = useSession((state) => state.logOut);

  // Selection is stored only once the user makes one; until then the first entry is used.
  // Derived rather than written into state from an effect, which would render twice and
  // briefly show a state that never really existed.
  const [pickedServerId, setPickedServerId] = useState<string | null>(null);
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null);

  const servers = useQuery({ queryKey: ["servers"], queryFn: fetchMyServers });
  const serverId = pickedServerId ?? servers.data?.[0]?.id ?? null;

  const server = useQuery({
    queryKey: ["server", serverId],
    queryFn: () => fetchServer(serverId as string),
    enabled: serverId !== null,
  });

  const unread = useQuery({
    queryKey: ["unread", serverId],
    queryFn: () => fetchUnread(serverId as string),
    enabled: serverId !== null,
    // Counts change from other people's messages, so they are polled rather than derived.
    refetchInterval: 15_000,
  });

  const channelId =
    pickedChannelId ??
    server.data?.channels.find((channel) => channel.type === "TEXT")?.id ??
    null;

  const activeChannel: ChannelView | null =
    server.data?.channels.find((channel) => channel.id === channelId) ?? null;

  return (
    <div className="flex h-dvh bg-neutral-950 text-white">
      <aside className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-white/10 py-4">
        {(servers.data ?? []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.name}
            onClick={() => {
              setPickedServerId(entry.id);
              setPickedChannelId(null);
            }}
            className={`grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold ${
              entry.id === serverId ? "bg-white/90 text-neutral-950" : "bg-white/10 text-white/70"
            }`}
          >
            {entry.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
      </aside>

      {server.data ? (
        <ChannelSidebar
          server={server.data}
          unread={unread.data?.channels ?? []}
          activeChannelId={channelId}
          onSelect={(channel) => {
            setPickedChannelId(channel.id);
          }}
        />
      ) : (
        <nav className="w-60 shrink-0 border-r border-white/10 px-4 py-4 text-sm text-white/40">
          {servers.isPending
            ? "Загружаем…"
            : "Пока нет ни одного сервера. Попросите приглашение или создайте свой."}
        </nav>
      )}

      <main className="flex flex-1 flex-col">
        <ChatPanel channel={activeChannel} />
      </main>

      <footer className="absolute bottom-3 left-3 flex items-center gap-2 text-xs text-white/40">
        <span>{user?.displayName}</span>
        <button
          type="button"
          onClick={() => void logOut()}
          className="underline-offset-4 hover:underline"
        >
          выйти
        </button>
      </footer>
    </div>
  );
}
