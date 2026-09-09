import type { ContactProfile, DirectConversationView, RelationshipsView } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { Avatar } from "../../shared/ui/Avatar";

interface RelationshipListsProps {
  readonly relationships: RelationshipsView | undefined;
  readonly conversations: readonly DirectConversationView[] | undefined;
  readonly onOpen: (conversation: DirectConversationView) => void;
  readonly onMessage: (username: string) => void;
  readonly onAccept: (requestId: string) => void;
  readonly onDecline: (requestId: string) => void;
  readonly onCancel: (requestId: string) => void;
  readonly onUnfriend: (username: string) => void;
  readonly onUnblock: (username: string) => void;
}

export function RelationshipLists(props: RelationshipListsProps) {
  const { t } = useTranslation();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {(props.relationships?.incoming.length ?? 0) > 0 ? (
        <Section title={t("friends.incoming")}>
          {props.relationships?.incoming.map((request) => (
            <ContactRow
              key={request.id}
              profile={request.user}
              actions={[
                { label: t("friends.accept"), onClick: () => props.onAccept(request.id) },
                {
                  label: t("friends.decline"),
                  onClick: () => props.onDecline(request.id),
                  danger: true,
                },
              ]}
            />
          ))}
        </Section>
      ) : null}
      {(props.relationships?.outgoing.length ?? 0) > 0 ? (
        <Section title={t("friends.outgoing")}>
          {props.relationships?.outgoing.map((request) => (
            <ContactRow
              key={request.id}
              profile={request.user}
              actions={[
                {
                  label: t("friends.cancel"),
                  onClick: () => props.onCancel(request.id),
                  danger: true,
                },
              ]}
            />
          ))}
        </Section>
      ) : null}
      <Section title={t("friends.messages")}>
        {props.conversations?.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            onOpen={props.onOpen}
          />
        ))}
      </Section>
      <Section title={t("friends.friends")}>
        {props.relationships?.friends.map((friend) => (
          <ContactRow
            key={friend.username}
            profile={friend}
            actions={[
              ...(friend.capabilities.canMessage
                ? [{ label: t("friends.write"), onClick: () => props.onMessage(friend.username) }]
                : []),
              {
                label: t("friends.unfriend"),
                onClick: () => props.onUnfriend(friend.username),
                danger: true,
              },
            ]}
          />
        ))}
      </Section>
      {(props.relationships?.blocked.length ?? 0) > 0 ? (
        <Section title={t("friends.blocked")}>
          {props.relationships?.blocked.map((profile) => (
            <ContactRow
              key={profile.username}
              profile={profile}
              actions={[
                { label: t("friends.unblock"), onClick: () => props.onUnblock(profile.username) },
              ]}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function ConversationRow({
  conversation,
  onOpen,
}: {
  readonly conversation: DirectConversationView;
  readonly onOpen: (value: DirectConversationView) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(conversation)}
      className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-panel-hover"
    >
      <Avatar
        name={conversation.participant.displayName}
        url={conversation.participant.avatarUrl}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {conversation.participant.displayName}
        </span>
        <span className="block truncate text-xs text-muted">
          @{conversation.participant.username}
          {conversation.lastMessage === null ? null : ` · ${conversation.lastMessage.text}`}
        </span>
      </span>
      {conversation.unreadCount > 0 ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
          {conversation.unreadCount}
        </span>
      ) : null}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h2 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
        {title}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function ContactRow({
  profile,
  actions = [],
}: {
  readonly profile: ContactProfile;
  readonly actions?: readonly ContactAction[];
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl p-2">
      <Avatar name={profile.displayName} url={profile.avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{profile.displayName}</span>
        <span className="block truncate text-xs text-muted">@{profile.username}</span>
      </span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={
            action.danger
              ? "rounded-lg px-2 py-1 text-[10px] font-semibold text-danger-soft"
              : "rounded-lg border border-line px-2 py-1 text-[10px] font-semibold text-ink-soft"
          }
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

interface ContactAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly danger?: boolean;
}
