import {
  UPLOAD_ROUTES,
  type PublicUser,
  type ReservedUploadResponse,
  type UploadPurpose,
  type UploadView,
} from "@voreli/shared";

import { apiFetch } from "../../shared/api/http";

export interface PendingUpload {
  readonly uploadId: string;
  readonly checksumSha256: string;
}

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}

export async function stageUpload(
  file: File,
  purpose: UploadPurpose,
  onProgress: (progress: UploadProgress) => void,
): Promise<PendingUpload> {
  const reservation = await apiFetch<ReservedUploadResponse>(UPLOAD_ROUTES.reserve, {
    method: "POST",
    body: {
      fileName: file.name,
      byteSize: file.size,
      declaredMime: file.type,
      purpose,
    },
  });

  await uploadDirectly(file, reservation, onProgress);
  const checksumSha256 = await sha256(file);
  return { uploadId: reservation.uploadId, checksumSha256 };
}

export async function resumeUpload(pending: PendingUpload): Promise<UploadView> {
  const upload = await apiFetch<UploadView>(UPLOAD_ROUTES.byId(pending.uploadId));
  if (upload.status !== "reserved") return upload;
  return apiFetch<UploadView>(UPLOAD_ROUTES.complete(pending.uploadId), {
    method: "POST",
    body: { checksumSha256: pending.checksumSha256 },
  });
}

export function setAvatar(uploadId: string) {
  return apiFetch<PublicUser>(UPLOAD_ROUTES.avatar, {
    method: "PUT",
    body: { uploadId },
  });
}

function uploadDirectly(
  file: File,
  reservation: ReservedUploadResponse,
  onProgress: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(reservation.upload.method, reservation.upload.url);
    request.upload.addEventListener("progress", (event) => {
      onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : file.size });
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(`Object storage refused upload with status ${String(request.status)}`));
      }
    });
    request.addEventListener("error", () => reject(new Error("Object storage upload failed")));
    request.addEventListener("abort", () => reject(new Error("Object storage upload was aborted")));

    const form = new FormData();
    for (const [name, value] of Object.entries(reservation.upload.fields)) {
      form.append(name, value);
    }
    form.append("file", file, file.name);
    request.send(form);
  });
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
