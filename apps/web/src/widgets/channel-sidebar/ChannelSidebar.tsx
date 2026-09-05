import type { CategoryView, ChannelView, ServerView, UnreadCount } from "@voreli/shared";

import { useSession } from "../../entities/session/session.store";
import { useVoice } from "../../entities/voice/voice.store";

interface ChannelSidebarProps {
  readonly server: ServerView;
  readonly unread: readonly UnreadCount[];
  readonly activeChannelId: string | null;
  readonly onSelect: (channel: ChannelView) => void;
}

/**
 * Channels grouped by category. Channels the member may not view never arrive from the
 * server, so there is nothing to filter here — and nothing to accidentally reveal.
 */
export function ChannelSidebar({ server, unread, activeChannelId, onSelect }: ChannelSidebarProps) {
  const voiceChannelId = useVoice((state) => state.channelId);
  const voiceParticipants = useVoice((state) => state.participants);
  const currentUserId = useSession((state) => state.user?.id);
  const unreadByChannel = new Map(unread.map((entry) => [entry.channelId, entry.count]));
  const uncategorised = server.channels.filter((channel) => channel.categoryId === null);

  return (
    <nav className="w-60 shrink-0 overflow-y-auto border-r border-white/10 px-2 py-4">
      <h2 className="px-2 pb-3 text-sm font-semibold text-white">{server.name}</h2>

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
          currentUserId={currentUserId}
        />
      ))}

      {uncategorised.length === 0 ? null : (
        <CategoryBlock
          category={{ id: "none", name: "Без категории", position: 999 }}
          channels={uncategorised}
          unread={unreadByChannel}
          activeChannelId={activeChannelId}
          onSelect={onSelect}
          voiceChannelId={voiceChannelId}
          voiceParticipants={voiceParticipants}
          currentUserId={currentUserId}
        />
      )}
    </nav>
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
}: CategoryBlockProps) {
  if (channels.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <p className="px-2 pb-1 text-xs uppercase tracking-wide text-white/30">{category.name}</p>
      <ul>
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
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                  active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"
                }`}
              >
                <span className="truncate">
                  <span className="mr-1 text-white/30">{channel.type === "VOICE" ? "@" : "#"}</span>
                  {channel.name}
                </span>
                {count > 0 && !active ? (
                  <span
                    data-testid={`unread-${channel.id}`}
                    className="ml-2 rounded-full bg-white/80 px-1.5 text-xs font-medium text-neutral-950"
                  >
                    {count}
                  </span>
                ) : null}
              </button>
              {channel.id === voiceChannelId ? (
                <ul className="ml-7 space-y-1 py-1 text-xs text-white/45">
                  {voiceParticipants.map((participant) => (
                    <li key={participant.userId}>
                      {participant.userId === currentUserId
                        ? "Вы"
                        : `Участник ${participant.userId.slice(0, 6)}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
