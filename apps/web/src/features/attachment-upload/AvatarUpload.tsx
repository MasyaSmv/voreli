import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PendingAvatarUpload } from "./PendingAvatarUpload";
import { stageUpload } from "./upload-client";
import { usePendingAvatar } from "./use-pending-avatar";

export function AvatarUpload({ ownerId }: { readonly ownerId: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { pending, remember } = usePendingAvatar(ownerId);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File): Promise<void> {
    setError(null);
    setProgress(0);

    try {
      const upload = await stageUpload(file, "avatar", ({ loaded, total }) => {
        setProgress(total === 0 ? 0 : Math.round((loaded / total) * 100));
      });

      remember(upload);
      setProgress(null);
    } catch (reason: unknown) {
      console.error("Avatar upload failed", {
        error: reason,
        ownerId,
        fileName: file.name,
        operation: "avatar.upload",
      });
      setProgress(null);
      setError(reason instanceof Error ? reason.message : t("settings.avatarFailed"));
    } finally {
      if (input.current) {
        input.current.value = "";
      }
    }
  }

  if (pending)
    return (
      <PendingAvatarUpload
        key={pending.uploadId}
        pending={pending}
        ownerId={ownerId}
        onFinished={() => remember(null)}
      />
    );

  return (
    <div
      className="mt-3"
      onPaste={(event) => {
        const file = [...event.clipboardData.files].find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        if (file && progress === null) {
          event.preventDefault();
          void choose(file);
        }
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      <button
        type="button"
        disabled={progress !== null}
        onClick={() => input.current?.click()}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-accent/50 hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        {progress === null
          ? t("settings.changeAvatar")
          : t("settings.uploadingAvatar", { progress })}
      </button>
      <p className="mt-1 text-xs text-muted">{t("settings.pasteAvatar")}</p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger-soft">
          {error}
        </p>
      ) : null}
    </div>
  );
}
