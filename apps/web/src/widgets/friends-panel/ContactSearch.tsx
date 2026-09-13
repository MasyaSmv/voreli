import type { ContactProfile } from "@voreli/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { lookupContact } from "../../entities/relationship/relationship.api";
import { Avatar } from "../../shared/ui/Avatar";

interface ContactSearchProps {
  readonly resetKey: number;
  readonly onMessage: (username: string) => void;
  readonly onFriend: (username: string) => void;
  readonly onBlock: (username: string) => void;
}

export function ContactSearch(props: ContactSearchProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [result, setResult] = useState<{ key: number; profile: ContactProfile } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const found = result?.key === props.resetKey ? result.profile : null;

  async function search(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLookupError(null);
    try {
      const response = await lookupContact(username);
      setResult(response.user === null ? null : { key: props.resetKey, profile: response.user });
      if (response.user === null) setLookupError(t("friends.notFound"));
    } catch {
      setResult(null);
      setLookupError(t("friends.notFound"));
    }
  }

  return (
    <div className="border-b border-line p-4">
      <h1 className="text-sm font-bold text-ink">{t("friends.title")}</h1>
      <form className="mt-3 flex gap-2" onSubmit={(event) => void search(event)}>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="@username"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-raised px-3 py-2 text-sm text-ink outline-none focus:border-accent/60"
        />
        <button
          className="rounded-xl bg-accent px-3 text-xs font-semibold text-white"
          type="submit"
        >
          {t("friends.find")}
        </button>
      </form>
      {lookupError === null ? null : <p className="mt-2 text-xs text-danger-soft">{lookupError}</p>}
      {found === null ? null : <ContactResult profile={found} {...props} />}
    </div>
  );
}

function ContactResult({
  profile,
  onMessage,
  onFriend,
  onBlock,
}: ContactSearchProps & { readonly profile: ContactProfile }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 rounded-xl border border-line bg-panel-raised p-3">
      <div className="flex items-center gap-3">
        <Avatar name={profile.displayName} url={profile.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{profile.displayName}</p>
          <p className="truncate text-xs text-muted">@{profile.username}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {profile.capabilities.canMessage ? (
          <Action label={t("friends.write")} primary onClick={() => onMessage(profile.username)} />
        ) : null}
        {profile.capabilities.canFriendRequest ? (
          <Action label={t("friends.add")} onClick={() => onFriend(profile.username)} />
        ) : null}
        {profile.capabilities.canCall ? (
          <span className="self-center text-[10px] text-muted">{t("friends.callsAllowed")}</span>
        ) : null}
        <button
          type="button"
          onClick={() => onBlock(profile.username)}
          className="ml-auto rounded-lg px-2 py-1.5 text-[10px] font-semibold text-danger-soft"
        >
          {t("friends.block")}
        </button>
      </div>
    </div>
  );
}

function Action({
  label,
  primary = false,
  onClick,
}: {
  readonly label: string;
  readonly primary?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
          : "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft"
      }
    >
      {label}
    </button>
  );
}
