import { Readable } from "node:stream";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/env.validation.js";
import type { ObjectMetadata, ObjectStorage, PresignedUpload } from "./object-storage.js";

@Injectable()
export class S3ObjectStorage implements ObjectStorage, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.bucket = config.get("S3_BUCKET", { infer: true });
    this.client = new S3Client({
      endpoint: config.get("S3_ENDPOINT", { infer: true }),
      region: config.get("S3_REGION", { infer: true }),
      forcePathStyle: config.get("S3_FORCE_PATH_STYLE", { infer: true }),
      requestHandler: {
        connectionTimeout: 1_000,
        requestTimeout: 30_000,
        throwOnRequestTimeout: true,
      },
      credentials: {
        accessKeyId: config.get("S3_ACCESS_KEY", { infer: true }),
        secretAccessKey: config.get("S3_SECRET_KEY", { infer: true }),
      },
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async reserveUpload(
    objectKey: string,
    contentType: string,
    byteSize: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    await this.ensureBucket();
    const result = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: objectKey,
      Expires: expiresInSeconds,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["eq", "$key", objectKey],
        ["eq", "$Content-Type", contentType],
        ["content-length-range", byteSize, byteSize],
      ],
    });

    return { url: result.url, fields: result.fields };
  }

  async head(objectKey: string): Promise<ObjectMetadata | null> {
    await this.ensureBucket();

    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );

      return {
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
      };
    } catch (error: unknown) {
      if (error instanceof NoSuchKey || error instanceof NotFound || this.statusOf(error) === 404) {
        return null;
      }

      throw error;
    }
  }

  async read(objectKey: string): Promise<Readable> {
    await this.ensureBucket();
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );

    if (!result.Body) {
      throw new Error(`S3 returned an empty body for ${objectKey}`);
    }

    if (result.Body instanceof Readable) {
      return result.Body;
    }

    return Readable.fromWeb(result.Body.transformToWebStream());
  }

  async write(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async presignDownload(
    objectKey: string,
    fileName: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    await this.ensureBucket();
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        ResponseContentType: contentType,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= this.findOrCreateBucket().catch((error: unknown) => {
      this.bucketReady = null;
      throw error;
    });
    return this.bucketReady;
  }

  private async findOrCreateBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      if (this.statusOf(error) !== 404) {
        throw error;
      }

      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  private statusOf(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("$metadata" in error)) {
      return undefined;
    }

    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    return metadata?.httpStatusCode;
  }
}
