import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelKind, ChannelView } from "@voreli/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { createChannel } from "../../entities/server/server.api";
import { HttpError } from "../../shared/api/http";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";

interface CreateChannelDialogProps {
  readonly serverId: string;
  readonly onCreated: (channel: ChannelView) => void;
  readonly onClose: () => void;
}

export function CreateChannelDialog({ serverId, onCreated, onClose }: CreateChannelDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelKind>("TEXT");
  const mutation = useMutation({
    mutationFn: () => createChannel(serverId, { name: name.trim(), type }),
    onSuccess: async (channel) => {
      await queryClient.invalidateQueries({ queryKey: ["server", serverId] });
      onCreated(channel);
    },
  });

  return (
    <Dialog
      title={t("channels.createTitle")}
      description={t("channels.createDescription")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <form
        className="space-y-5 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length > 0) mutation.mutate();
        }}
      >
        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
            {t("channels.type")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["TEXT", "VOICE"] as const).map((channelType) => (
              <label
                key={channelType}
                className={
                  "flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm transition " +
                  (type === channelType
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-line bg-panel text-muted hover:border-line-strong")
                }
              >
                <input
                  type="radio"
                  name="channel-type"
                  value={channelType}
                  checked={type === channelType}
                  onChange={() => setType(channelType)}
                  className="sr-only"
                />
                <Icon name={channelType === "TEXT" ? "hash" : "volume"} className="h-4 w-4" />
                {t(channelType === "TEXT" ? "channels.text" : "channels.voice")}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-bold uppercase tracking-wider text-muted">
          {t("channels.name")}
          <input
            autoFocus
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("channels.namePlaceholder")}
            className="mt-2 h-11 w-full rounded-xl border border-line bg-panel px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
          />
        </label>

        {mutation.error ? (
          <p role="alert" className="text-sm text-danger-soft">
            {mutation.error instanceof HttpError
              ? mutation.error.message
              : t("channels.createError")}
          </p>
        ) : null}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 px-4 text-sm text-muted">
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={name.trim().length === 0 || mutation.isPending}
            className="h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? t("channels.creating") : t("channels.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
