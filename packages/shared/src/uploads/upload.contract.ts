export const UPLOAD_ROUTES = {
  reserve: "/uploads/reserve",
  byId: (uploadId: string): string => `/uploads/${uploadId}`,
  complete: (uploadId: string): string => `/uploads/${uploadId}/complete`,
  avatar: "/users/me/avatar",
} as const;

export type UploadPurpose = "attachment" | "avatar";
export type UploadStatus =
  "reserved" | "uploaded" | "processing" | "ready" | "rejected" | "expired";

export interface ReserveUploadRequest {
  readonly fileName: string;
  readonly byteSize: number;
  readonly declaredMime: string;
  readonly purpose: UploadPurpose;
}

export interface PresignedPostUpload {
  readonly method: "POST";
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ReservedUploadResponse {
  readonly uploadId: string;
  readonly upload: PresignedPostUpload;
  readonly expiresAt: string;
}

export interface CompleteUploadRequest {
  readonly checksumSha256: string;
}

export interface UploadView {
  readonly id: string;
  readonly purpose: UploadPurpose;
  readonly status: UploadStatus;
  readonly originalName: string;
  readonly declaredMime: string;
  readonly detectedMime: string | null;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly rejectionCode: string | null;
  readonly expiresAt: string;
  readonly completedAt: string | null;
}

export interface SetAvatarRequest {
  readonly uploadId: string;
}
