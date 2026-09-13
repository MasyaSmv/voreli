import type { DirectConversationView, ServerSummary } from "@voreli/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandMark } from "../../shared/ui/BrandMark";
import { DirectMessagePanel } from "../chat/DirectMessagePanel";
import { FriendsPanel } from "../friends-panel/FriendsPanel";

export function ServerHome({
  servers,
  onSelect,
}: {
  readonly servers: readonly ServerSummary[];
  readonly onSelect: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<DirectConversationView | null>(null);

  return (
    <main className="flex min-w-0 flex-1 bg-canvas">
      <FriendsPanel onOpen={setConversation} />
      {conversation !== null ? (
        <DirectMessagePanel conversation={conversation} />
      ) : (
        <div className="min-w-0 flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-3xl">
            <BrandMark />
            <h1 className="mt-8 text-3xl font-bold tracking-[-0.04em] text-ink">
              {t("home.title")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">{t("home.description")}</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {servers.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => onSelect(server.id)}
                  className="rounded-2xl border border-line bg-panel p-5 text-left transition hover:border-line-strong hover:bg-panel-raised"
                >
                  <span className="text-sm font-semibold text-ink">{server.name}</span>
                  <span className="mt-1 block text-xs text-muted">{t("home.openServer")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
