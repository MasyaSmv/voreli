import { useQuery } from "@tanstack/react-query";
import type { ChannelView } from "@voreli/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { voiceSession } from "../../features/voice-join/voice-session";
import { directCallSession } from "../../features/direct-call/direct-call-session";
import { fetchMyServers, fetchServer, fetchUnread } from "../../entities/server/server.api";
import { ChannelSidebar } from "../../widgets/channel-sidebar/ChannelSidebar";
import { ChatPanel } from "../../widgets/chat/ChatPanel";
import { ServerRail } from "../../widgets/server-rail/ServerRail";
import { ServerHome } from "../../widgets/server-home/ServerHome";
import { VoicePanel } from "../../widgets/voice-panel/VoicePanel";
import { DirectCallOverlay } from "../../widgets/direct-call/DirectCallOverlay";

/** The desktop workspace composes navigation and the active real-time surface. */
export function WorkspacePage() {
  const { t } = useTranslation();
  const logOut = useSession((state) => state.logOut);
  const currentUser = useSession((state) => state.user);
  const [pickedServerId, setPickedServerId] = useState<string | null | undefined>(undefined);
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser) directCallSession.connect();
    return () => directCallSession.reset();
  }, [currentUser]);

  const servers = useQuery({ queryKey: ["servers"], queryFn: fetchMyServers });
  const serverId = pickedServerId === undefined ? (servers.data?.[0]?.id ?? null) : pickedServerId;

  const server = useQuery({
    queryKey: ["server", serverId],
    queryFn: () => fetchServer(serverId as string),
    enabled: serverId !== null,
  });

  const unread = useQuery({
    queryKey: ["unread", serverId],
    queryFn: () => fetchUnread(serverId as string),
    enabled: serverId !== null,
    refetchInterval: 15_000,
  });

  const channelId =
    pickedChannelId ?? server.data?.channels.find((channel) => channel.type === "TEXT")?.id ?? null;
  const activeChannel: ChannelView | null =
    server.data?.channels.find((channel) => channel.id === channelId) ?? null;

  return (
    <div className="flex h-dvh min-w-[48rem] bg-canvas text-ink">
      <ServerRail
        servers={servers.data ?? []}
        activeServerId={serverId}
        onHome={() => {
          setPickedServerId(null);
          setPickedChannelId(null);
        }}
        onSelect={(selectedServerId) => {
          setPickedServerId(selectedServerId);
          setPickedChannelId(null);
        }}
      />

      {servers.isPending ? <WorkspaceLoading /> : null}

      {serverId === null && !servers.isPending ? (
        <ServerHome
          servers={servers.data ?? []}
          onSelect={(selectedServerId) => setPickedServerId(selectedServerId)}
        />
      ) : null}

      {serverId !== null && server.data ? (
        <ChannelSidebar
          server={server.data}
          unread={unread.data?.channels ?? []}
          activeChannelId={channelId}
          onSelect={(channel) => {
            setPickedChannelId(channel.id);
          }}
          onLogout={() =>
            void voiceSession
              .leave()
              .catch(() => undefined)
              .then(() => logOut())
          }
        />
      ) : serverId !== null ? (
        <nav className="flex w-[17rem] shrink-0 flex-col border-r border-line bg-panel px-5 py-5 text-sm text-muted">
          <div className="h-6 w-32 animate-pulse rounded-lg bg-panel-hover" />
          <div className="mt-8 space-y-3">
            {servers.isPending ? (
              <>
                <div className="h-8 animate-pulse rounded-lg bg-panel-hover" />
                <div className="h-8 animate-pulse rounded-lg bg-panel-hover" />
                <div className="h-8 animate-pulse rounded-lg bg-panel-hover" />
              </>
            ) : (
              <p className="leading-6">{t("workspace.noServers")}</p>
            )}
          </div>
        </nav>
      ) : null}

      {serverId !== null ? (
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {activeChannel?.type === "VOICE" ? (
            <VoicePanel channel={activeChannel} permissions={server.data?.permissions ?? "0"} />
          ) : (
            <ChatPanel channel={activeChannel} />
          )}
        </main>
      ) : null}
      <DirectCallOverlay />
    </div>
  );
}

function WorkspaceLoading() {
  const { t } = useTranslation();

  return (
    <main
      className="flex min-w-0 flex-1 items-center justify-center bg-canvas"
      aria-label={t("workspace.loading")}
    >
      <div className="h-10 w-48 animate-pulse rounded-xl bg-panel-hover" />
    </main>
  );
}
