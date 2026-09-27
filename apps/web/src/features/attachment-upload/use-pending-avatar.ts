import { useState } from "react";

import type { PendingUpload } from "./upload-client";

function storageKey(ownerId: string): string {
  return `voreli.pending-avatar.${ownerId}`;
}

function read(ownerId: string): PendingUpload | null {
  try {
    const serialized = localStorage.getItem(storageKey(ownerId));
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || !value) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record["uploadId"] !== "string" ||
      !record["uploadId"] ||
      typeof record["checksumSha256"] !== "string" ||
      !/^[a-f0-9]{64}$/.test(record["checksumSha256"])
    )
      return null;
    return { uploadId: record["uploadId"], checksumSha256: record["checksumSha256"] };
  } catch (error: unknown) {
    console.error("Unable to restore pending avatar", {
      error,
      ownerId,
      operation: "avatar.restore",
    });
    return null;
  }
}

export function usePendingAvatar(ownerId: string) {
  const [pending, setPending] = useState(() => read(ownerId));

  function remember(value: PendingUpload | null): void {
    try {
      if (value) localStorage.setItem(storageKey(ownerId), JSON.stringify(value));
      else localStorage.removeItem(storageKey(ownerId));
    } catch (error: unknown) {
      console.error("Unable to persist pending avatar", {
        error,
        ownerId,
        operation: "avatar.persist",
      });
    }
    setPending(value);
  }
  return { pending, remember };
}
