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
  const [mobileView, setMobileView] = useState<"servers" | "channels" | "content">("content");

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
    <div className="flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-canvas pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink">
      <nav
        className="flex shrink-0 gap-1 border-b border-line bg-panel p-2 md:hidden"
        aria-label={t("workspace.mobileNavigation")}
      >
        <MobileViewButton
          label={t("workspace.servers")}
          active={mobileView === "servers"}
          onClick={() => setMobileView("servers")}
        />
        {serverId !== null ? (
          <MobileViewButton
            label={t("workspace.channels")}
            active={mobileView === "channels"}
            onClick={() => setMobileView("channels")}
          />
        ) : null}
        <MobileViewButton
          label={t("workspace.conversation")}
          active={mobileView === "content"}
          onClick={() => setMobileView("content")}
        />
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 bg-canvas text-ink">
        <div
          className={`${mobileView === "servers" ? "flex" : "hidden"} min-h-0 w-full md:flex md:w-auto`}
        >
          <ServerRail
            servers={servers.data ?? []}
            activeServerId={serverId}
            onHome={() => {
              setPickedServerId(null);
              setPickedChannelId(null);
              setMobileView("content");
            }}
            onSelect={(selectedServerId) => {
              setPickedServerId(selectedServerId);
              setPickedChannelId(null);
              setMobileView("channels");
            }}
          />
        </div>

        {servers.isPending ? <WorkspaceLoading /> : null}

        {serverId === null && !servers.isPending ? (
          <div
            className={`${mobileView === "content" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:flex`}
          >
            <ServerHome
              servers={servers.data ?? []}
              onSelect={(selectedServerId) => {
                setPickedServerId(selectedServerId);
                setMobileView("channels");
              }}
            />
          </div>
        ) : null}

        {serverId !== null && server.data ? (
          <div
            className={`${mobileView === "channels" ? "flex" : "hidden"} min-h-0 w-full md:flex md:w-auto`}
          >
            <ChannelSidebar
              server={server.data}
              unread={unread.data?.channels ?? []}
              activeChannelId={channelId}
              onSelect={(channel) => {
                setPickedChannelId(channel.id);
                setMobileView("content");
              }}
              onLogout={() =>
                void voiceSession
                  .leave()
                  .catch((error: unknown) => {
                    console.error("Failed to leave voice before logout", { error });
                  })
                  .then(() => logOut())
              }
            />
          </div>
        ) : serverId !== null ? (
          <nav
            className={`${mobileView === "channels" ? "flex" : "hidden"} w-full shrink-0 flex-col border-r border-line bg-panel px-5 py-5 text-sm text-muted md:flex md:w-[17rem]`}
          >
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
          <main
            className={`${mobileView === "content" ? "flex" : "hidden"} min-w-0 flex-1 flex-col bg-canvas md:flex`}
          >
            {activeChannel?.type === "VOICE" ? (
              <VoicePanel channel={activeChannel} permissions={server.data?.permissions ?? "0"} />
            ) : (
              <ChatPanel channel={activeChannel} />
            )}
          </main>
        ) : null}
        <DirectCallOverlay />
      </div>
    </div>
  );
}

function MobileViewButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-xl px-2 text-xs font-semibold ${active ? "bg-accent text-white" : "text-muted"}`}
    >
      {label}
    </button>
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
