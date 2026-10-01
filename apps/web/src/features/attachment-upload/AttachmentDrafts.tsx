import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../shared/api/http";
import type { DraftAttachment } from "./useAttachmentDrafts";

export function AttachmentDrafts({
  items,
  remove,
}: {
  readonly items: readonly DraftAttachment[];
  readonly remove: (id: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded border border-line p-2 text-xs text-muted">
          {item.upload?.status === "ready" && item.upload.width !== null && (
            <DraftPreview uploadId={item.upload.id} name={item.name} />
          )}
          <span>{item.name}</span>{" "}
          <span>
            {item.error ??
              (item.upload?.status === "ready" ? "Готово" : `${item.progress}% · обработка`)}
          </span>
          <button type="button" aria-label={`Убрать ${item.name}`} onClick={() => remove(item.id)}>
            {" "}
            ×{" "}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DraftPreview({ uploadId, name }: { readonly uploadId: string; readonly name: string }) {
  const preview = useQuery({
    queryKey: ["upload-preview", uploadId],
    queryFn: () => apiFetch<{ url: string }>(`/uploads/${uploadId}/preview`),
    staleTime: 240_000,
    gcTime: 0,
  });
  return preview.data ? (
    <img src={preview.data.url} alt={name} className="h-16 w-16 rounded object-cover" />
  ) : null;
}
