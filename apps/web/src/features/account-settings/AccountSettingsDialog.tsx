import type { PublicUser } from "@voreli/shared";
import { ContactAudience } from "@voreli/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Avatar } from "../../shared/ui/Avatar";
import { Dialog } from "../../shared/ui/Dialog";
import { LanguageSwitcher } from "../../shared/ui/LanguageSwitcher";
import {
  fetchContactSettings,
  updateContactSettings,
} from "../../entities/relationship/relationship.api";

export function AccountSettingsDialog({
  user,
  onClose,
}: {
  readonly user: PublicUser;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["contact-settings"], queryFn: fetchContactSettings });
  const update = useMutation({
    mutationFn: updateContactSettings,
    onSuccess: (value) => queryClient.setQueryData(["contact-settings"], value),
  });

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
        <section aria-labelledby="contact-privacy-heading">
          <h3
            id="contact-privacy-heading"
            className="mb-3 text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t("settings.contactPrivacy")}
          </h3>
          <div className="space-y-3">
            <AudienceSelect
              label={t("settings.messagesFrom")}
              value={settings.data?.directMessageAudience}
              onChange={(directMessageAudience) => update.mutate({ directMessageAudience })}
            />
            <AudienceSelect
              label={t("settings.callsFrom")}
              value={settings.data?.directCallAudience}
              onChange={(directCallAudience) => update.mutate({ directCallAudience })}
            />
            <AudienceSelect
              label={t("settings.requestsFrom")}
              value={settings.data?.friendRequestAudience}
              onChange={(friendRequestAudience) => update.mutate({ friendRequestAudience })}
            />
            <button
              type="button"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  directMessageAudience: ContactAudience.Nobody,
                  directCallAudience: ContactAudience.Nobody,
                  friendRequestAudience: ContactAudience.Nobody,
                })
              }
              className="w-full rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-danger/40 hover:text-danger-soft"
            >
              {t("settings.closeContacts")}
            </button>
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

function AudienceSelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: (typeof ContactAudience)[keyof typeof ContactAudience]) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-ink-soft">
      <span>{label}</span>
      <select
        value={value ?? ContactAudience.Everyone}
        onChange={(event) =>
          onChange(event.target.value as (typeof ContactAudience)[keyof typeof ContactAudience])
        }
        className="rounded-lg border border-line bg-panel-raised px-2 py-1.5 text-xs text-ink"
      >
        <option value={ContactAudience.Everyone}>{t("settings.audienceEveryone")}</option>
        <option value={ContactAudience.Friends}>{t("settings.audienceFriends")}</option>
        <option value={ContactAudience.Nobody}>{t("settings.audienceNobody")}</option>
      </select>
    </label>
  );
}
