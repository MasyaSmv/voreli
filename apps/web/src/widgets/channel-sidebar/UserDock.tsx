import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { AccountSettingsDialog } from "../../features/account-settings/AccountSettingsDialog";
import { Avatar } from "../../shared/ui/Avatar";
import { Icon } from "../../shared/ui/Icon";

export function UserDock({ onLogout }: { readonly onLogout: () => void }) {
  const { t } = useTranslation();
  const user = useSession((state) => state.user);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <footer className="flex min-h-[4.5rem] items-center gap-2 border-t border-line bg-rail/45 px-3">
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label={t("settings.open")}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition hover:bg-panel-hover"
      >
        <span className="relative">
          <Avatar name={user?.displayName ?? "Voreli"} url={user?.avatarUrl ?? null} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[3px] border-panel bg-voice" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{user?.displayName}</span>
          <span className="block truncate text-[11px] text-faint">@{user?.username}</span>
        </span>
        <Icon name="settings" className="h-4 w-4 shrink-0 text-faint" />
      </button>
      <button
        type="button"
        onClick={onLogout}
        aria-label={t("workspace.logout")}
        title={t("workspace.logout")}
        className="grid h-9 w-9 place-items-center rounded-xl text-faint transition hover:bg-panel-hover hover:text-danger"
      >
        <Icon name="log-out" className="h-4 w-4" />
      </button>
      {settingsOpen && user ? (
        <AccountSettingsDialog user={user} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </footer>
  );
}
