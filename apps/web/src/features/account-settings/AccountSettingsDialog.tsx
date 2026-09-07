import type { PublicUser } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { Avatar } from "../../shared/ui/Avatar";
import { Dialog } from "../../shared/ui/Dialog";
import { LanguageSwitcher } from "../../shared/ui/LanguageSwitcher";

export function AccountSettingsDialog({
  user,
  onClose,
}: {
  readonly user: PublicUser;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog title={t("settings.title")} closeLabel={t("common.close")} onClose={onClose}>
      <div className="space-y-6 p-6">
        <section
          aria-labelledby="profile-heading"
          className="rounded-2xl border border-line bg-panel p-4"
        >
          <h3
            id="profile-heading"
            className="text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t("settings.profile")}
          </h3>
          <div className="mt-4 flex items-center gap-4">
            <Avatar name={user.displayName} url={user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{user.displayName}</p>
              <p className="truncate text-sm text-muted">@{user.username}</p>
            </div>
          </div>
        </section>
        <section aria-labelledby="language-heading">
          <h3
            id="language-heading"
            className="mb-3 text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t("common.language")}
          </h3>
          <LanguageSwitcher />
        </section>
      </div>
    </Dialog>
  );
}
