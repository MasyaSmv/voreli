import { useEffect, useRef, useState } from "react";
import type { UploadView } from "@voreli/shared";
import { resumeUpload, stageUpload } from "./upload-client";

export interface DraftAttachment {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly upload: UploadView | null;
  readonly error: string | null;
}

export function useAttachmentDrafts() {
  const [items, setItems] = useState<readonly DraftAttachment[]>([]);
  const mounted = useRef(true);
  const tasks = useRef(new Map<string, AbortController>());
  useEffect(() => {
    mounted.current = true;
    const activeTasks = tasks.current;
    return () => {
      mounted.current = false;
      for (const task of activeTasks.values()) task.abort();
      activeTasks.clear();
    };
  }, []);
  const update = (id: string, patch: Partial<DraftAttachment>) => {
    if (mounted.current)
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const add = (files: readonly File[]) => {
    for (const file of files.slice(0, Math.max(0, 10 - items.length))) {
      const id = crypto.randomUUID();
      const task = new AbortController();
      tasks.current.set(id, task);
      setItems((current) => [
        ...current,
        { id, name: file.name, progress: 0, upload: null, error: null },
      ]);
      void (async () => {
        const pending = await stageUpload(file, "attachment", (progress) =>
          update(id, {
            progress: Math.min(100, Math.round((100 * progress.loaded) / progress.total)),
          }),
        );
        if (task.signal.aborted) return;
        let upload = await resumeUpload(pending);
        while (
          !task.signal.aborted &&
          ["reserved", "uploaded", "processing"].includes(upload.status)
        ) {
          update(id, { upload });
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          if (task.signal.aborted) return;
          upload = await resumeUpload(pending);
        }
        update(id, {
          upload,
          error: upload.status === "ready" ? null : (upload.rejectionCode ?? upload.status),
        });
      })()
        .catch((error: unknown) => {
          console.error("Attachment upload failed", { error, fileName: file.name });
          update(id, { error: error instanceof Error ? error.message : "Ошибка загрузки" });
        })
        .finally(() => tasks.current.delete(id));
    }
  };
  return {
    items,
    add,
    remove: (id: string) => {
      tasks.current.get(id)?.abort();
      tasks.current.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    },
    clear: () => {
      for (const task of tasks.current.values()) task.abort();
      tasks.current.clear();
      setItems([]);
    },
    ready: items.every((item) => item.upload?.status === "ready" && !item.error),
    uploadIds: items.flatMap((item) => (item.upload?.status === "ready" ? [item.upload.id] : [])),
  };
}
