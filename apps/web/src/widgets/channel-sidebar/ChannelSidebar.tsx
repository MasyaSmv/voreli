import type { CategoryView, ChannelView, ServerView, UnreadCount } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";
import { Avatar } from "../../shared/ui/Avatar";
import { Icon } from "../../shared/ui/Icon";

interface ChannelSidebarProps {
  readonly server: ServerView;
  readonly unread: readonly UnreadCount[];
  readonly activeChannelId: string | null;
  readonly onSelect: (channel: ChannelView) => void;
  readonly onLogout: () => void;
}

export function ChannelSidebar({
  server,
  unread,
  activeChannelId,
  onSelect,
  onLogout,
}: ChannelSidebarProps) {
  const { t } = useTranslation();
  const voiceChannelId = useVoice((state) => state.channelId);
  const voiceParticipants = useVoice((state) => state.participants);
  const currentUser = useSession((state) => state.user);
  const unreadByChannel = new Map(unread.map((entry) => [entry.channelId, entry.count]));
  const uncategorised = server.channels.filter((channel) => channel.categoryId === null);

  return (
    <aside className="flex w-[17rem] shrink-0 flex-col border-r border-line bg-panel">
      <header className="flex min-h-16 items-center justify-between border-b border-line px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-ink">{server.name}</h2>
          <p className="mt-0.5 text-[11px] text-faint">
            {t("workspace.channelCount", { count: server.channels.length })}
          </p>
        </div>
        <Icon name="chevron-down" className="h-4 w-4 text-faint" />
      </header>

      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 py-4"
        aria-label={t("workspace.channelsLabel", { server: server.name })}
      >
        {server.categories.map((category) => (
          <CategoryBlock
            key={category.id}
            category={category}
            channels={server.channels.filter((channel) => channel.categoryId === category.id)}
            unread={unreadByChannel}
            activeChannelId={activeChannelId}
            onSelect={onSelect}
            voiceChannelId={voiceChannelId}
            voiceParticipants={voiceParticipants}
            currentUserId={currentUser?.id}
            participantLabel={(id) => t("workspace.participant", { id })}
          />
        ))}

        {uncategorised.length === 0 ? null : (
          <CategoryBlock
            category={{ id: "none", name: t("workspace.uncategorised"), position: 999 }}
            channels={uncategorised}
            unread={unreadByChannel}
            activeChannelId={activeChannelId}
            onSelect={onSelect}
            voiceChannelId={voiceChannelId}
            voiceParticipants={voiceParticipants}
            currentUserId={currentUser?.id}
            participantLabel={(id) => t("workspace.participant", { id })}
          />
        )}
      </nav>

      <footer className="flex min-h-[4.5rem] items-center gap-3 border-t border-line bg-rail/45 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="relative">
            <Avatar
              name={currentUser?.displayName ?? "Voreli"}
              url={currentUser?.avatarUrl ?? null}
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[3px] border-panel bg-voice" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">
              {currentUser?.displayName}
            </span>
            <span className="block truncate text-[11px] text-faint">@{currentUser?.username}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label={t("workspace.logout")}
          title={t("workspace.logout")}
          className="grid h-9 w-9 place-items-center rounded-xl text-faint transition hover:bg-panel-hover hover:text-danger"
        >
          <Icon name="log-out" className="h-4 w-4" />
        </button>
      </footer>
    </aside>
  );
}

interface CategoryBlockProps {
  readonly category: CategoryView;
  readonly channels: readonly ChannelView[];
  readonly unread: ReadonlyMap<string, number>;
  readonly activeChannelId: string | null;
  readonly onSelect: (channel: ChannelView) => void;
  readonly voiceChannelId: string | null;
  readonly voiceParticipants: ReturnType<typeof useVoice.getState>["participants"];
  readonly currentUserId: string | undefined;
  readonly participantLabel: (id: string) => string;
}

function CategoryBlock({
  category,
  channels,
  unread,
  activeChannelId,
  onSelect,
  voiceChannelId,
  voiceParticipants,
  currentUserId,
  participantLabel,
}: CategoryBlockProps) {
  const { t } = useTranslation();

  if (channels.length === 0) {
    return null;
  }

  return (
    <section className="mb-5" aria-labelledby={"category-" + category.id}>
      <h3
        id={"category-" + category.id}
        className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-faint"
      >
        {category.name}
      </h3>
      <ul className="space-y-0.5">
        {channels.map((channel) => {
          const count = unread.get(channel.id) ?? 0;
          const active = channel.id === activeChannelId;

          return (
            <li key={channel.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(channel);
                }}
                aria-current={active ? "page" : undefined}
                className={
                  "group flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm transition " +
                  (active
                    ? "bg-panel-hover text-ink"
                    : "text-muted hover:bg-panel-raised hover:text-ink-soft")
                }
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <Icon
                    name={channel.type === "VOICE" ? "volume" : "hash"}
                    className={"h-4 w-4 shrink-0 " + (active ? "text-accent-bright" : "text-faint")}
                  />
                  <span className="truncate">{channel.name}</span>
                </span>
                {count > 0 && !active ? (
                  <span
                    data-testid={"unread-" + channel.id}
                    className="ml-2 min-w-5 rounded-full bg-accent px-1.5 py-0.5 text-center text-[10px] font-bold text-white"
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </button>

              {channel.id === voiceChannelId ? (
                <ul className="ml-7 space-y-1 py-1.5">
                  {voiceParticipants.map((participant) => (
                    <li
                      key={participant.userId}
                      className="flex items-center gap-2 truncate py-0.5 text-xs text-muted"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-voice/80" />
                      <span className="truncate">
                        {participant.userId === currentUserId
                          ? t("common.you")
                          : participantLabel(participant.userId.slice(0, 6))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
