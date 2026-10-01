import { Dialog } from "../../shared/ui/Dialog";
import { useQuery } from "@tanstack/react-query";
import type { AttachmentView } from "@voreli/shared";
import { useState } from "react";
import { apiFetch } from "../../shared/api/http";

export function MessageAttachments({
  attachments,
}: {
  readonly attachments: readonly AttachmentView[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <Attachment key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function Attachment({ attachment }: { readonly attachment: AttachmentView }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["attachment-preview", attachment.id],
    enabled: attachment.thumbnailPath !== null,
    queryFn: () => apiFetch<{ url: string }>(attachment.thumbnailPath ?? ""),
    staleTime: 240_000,
    gcTime: 0,
  });
  async function download() {
    try {
      const { url } = await apiFetch<{ url: string }>(`/attachments/${attachment.id}/download-url`);
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      link.click();
    } catch (error: unknown) {
      console.error("Attachment download failed", { error, attachmentId: attachment.id });
      setError("Не удалось скачать файл");
    }
  }
  return (
    <div className="rounded-xl border border-line p-2 text-xs text-muted">
      {preview.data && (
        <button aria-label={`Открыть ${attachment.name}`} onClick={() => setOpen(true)}>
          <img src={preview.data.url} alt={attachment.name} className="max-h-64 max-w-72 rounded" />
        </button>
      )}
      <button onClick={() => void download()} className="block">
        {attachment.name} · {Math.ceil(attachment.byteSize / 1024)} KB ↓
      </button>
      {(error || preview.error) && <span role="alert">{error ?? "Превью недоступно"}</span>}
      {open && preview.data && (
        <Dialog title={attachment.name} closeLabel="Закрыть" onClose={() => setOpen(false)}>
          <img src={preview.data.url} alt={attachment.name} className="max-h-[80dvh] max-w-full" />
        </Dialog>
      )}
    </div>
  );
}
