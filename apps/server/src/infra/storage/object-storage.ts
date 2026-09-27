import type { Readable } from "node:stream";

export interface ObjectMetadata {
  readonly byteSize: number;
  readonly contentType: string | null;
}

export interface PresignedUpload {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ObjectStorage {
  reserveUpload(
    objectKey: string,
    contentType: string,
    byteSize: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  head(objectKey: string): Promise<ObjectMetadata | null>;
  read(objectKey: string): Promise<Readable>;
  write(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
  presignDownload(
    objectKey: string,
    fileName: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
