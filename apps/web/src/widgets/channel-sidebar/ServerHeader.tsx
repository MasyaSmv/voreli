import {
  hasPermission,
  parsePermissions,
  Permission,
  type ChannelView,
  type ServerView,
} from "@voreli/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CreateChannelDialog } from "../../features/channel-create/CreateChannelDialog";
import { Icon } from "../../shared/ui/Icon";

export function ServerHeader({
  server,
  onChannelCreated,
}: {
  readonly server: ServerView;
  readonly onChannelCreated: (channel: ChannelView) => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canManage =
    server.isOwner ||
    hasPermission(parsePermissions(server.permissions), Permission.ManageChannels);

  return (
    <header className="relative flex min-h-16 items-center justify-between border-b border-line px-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold text-ink">{server.name}</h2>
        <p className="mt-0.5 text-[11px] text-faint">
          {t("workspace.channelCount", { count: server.channels.length })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-label={t("workspace.serverMenu", { server: server.name })}
        title={t("workspace.serverMenu", { server: server.name })}
        className="grid h-10 w-10 place-items-center rounded-xl text-faint transition hover:bg-panel-hover hover:text-ink"
      >
        <Icon name="chevron-down" className="h-4 w-4" />
      </button>
      {menuOpen ? (
        <div className="absolute left-2 right-2 top-[calc(100%-0.25rem)] z-20 rounded-xl border border-line bg-panel-raised p-1.5 shadow-card">
          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setCreateOpen(true);
              }}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink-soft transition hover:bg-panel-hover hover:text-ink"
            >
              <Icon name="plus" className="h-4 w-4 text-accent-bright" />
              {t("channels.createTitle")}
            </button>
          ) : (
            <p className="px-3 py-2 text-xs text-muted">{t("workspace.noServerActions")}</p>
          )}
        </div>
      ) : null}
      {createOpen ? (
        <CreateChannelDialog
          serverId={server.id}
          onClose={() => setCreateOpen(false)}
          onCreated={(channel) => {
            setCreateOpen(false);
            onChannelCreated(channel);
          }}
        />
      ) : null}
    </header>
  );
}
