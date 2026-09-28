import type { UploadPurpose } from "@prisma/client";

export function uploadObjectKeys(upload: {
  readonly id: string;
  readonly ownerId: string;
  readonly purpose: UploadPurpose;
}): { staging: string; original: string; thumbnail: string } {
  const scope = upload.purpose === "AVATAR" ? "avatars" : "uploads";
  const path = `${upload.ownerId}/${upload.id}`;
  return {
    staging: `staging/${path}/original`,
    original: `${scope}/${path}/original`,
    thumbnail: `${scope}/${path}/thumbnail.webp`,
  };
}
