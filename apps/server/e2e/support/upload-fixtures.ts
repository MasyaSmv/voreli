import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";

/** User deletion cascades Upload rows, so remove their real objects before deleting fixtures. */
export async function disposeUploadFixtures(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<void> {
  const uploads = await prisma.upload.findMany({ where: { ownerId: { in: [...userIds] } } });
  if (!uploads.length) return;
  const storage = new S3Client({
    endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
    region: process.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env["S3_ACCESS_KEY"] ?? "voreli",
      secretAccessKey: process.env["S3_SECRET_KEY"] ?? "voreli-secret",
    },
  });
  const Bucket = process.env["S3_BUCKET"] ?? "voreli";
  try {
    for (const ownerId of new Set(uploads.map((upload) => upload.ownerId))) {
      for (const scope of ["staging", "uploads", "avatars"]) {
        const objects = await storage.send(
          new ListObjectsV2Command({ Bucket, Prefix: `${scope}/${ownerId}/` }),
        );
        const keys =
          objects.Contents?.flatMap((object) => (object.Key ? [{ Key: object.Key }] : [])) ?? [];
        if (keys.length)
          await storage.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
      }
    }
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: uploads.map((upload) => upload.id) } },
    });
  } finally {
    storage.destroy();
  }
}
