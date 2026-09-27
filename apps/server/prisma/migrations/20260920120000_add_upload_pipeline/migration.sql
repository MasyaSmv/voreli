CREATE TYPE "UploadPurpose" AS ENUM ('ATTACHMENT', 'AVATAR');
CREATE TYPE "UploadStatus" AS ENUM ('RESERVED', 'UPLOADED', 'PROCESSING', 'READY', 'REJECTED', 'EXPIRED');

CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "status" "UploadStatus" NOT NULL,
    "originalName" TEXT NOT NULL,
    "declaredMime" TEXT NOT NULL,
    "detectedMime" TEXT,
    "byteSize" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnailKey" TEXT,
    "rejectionCode" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "users" ADD COLUMN "avatarUploadId" TEXT;

CREATE UNIQUE INDEX "uploads_objectKey_key" ON "uploads"("objectKey");
CREATE INDEX "uploads_ownerId_status_reservedAt_idx" ON "uploads"("ownerId", "status", "reservedAt" DESC);
CREATE INDEX "uploads_status_expiresAt_idx" ON "uploads"("status", "expiresAt");
CREATE UNIQUE INDEX "attachments_uploadId_key" ON "attachments"("uploadId");
CREATE UNIQUE INDEX "attachments_messageId_position_key" ON "attachments"("messageId", "position");
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");
CREATE INDEX "outbox_events_publishedAt_nextAttempt_createdAt_idx" ON "outbox_events"("publishedAt", "nextAttempt", "createdAt");
CREATE UNIQUE INDEX "users_avatarUploadId_key" ON "users"("avatarUploadId");

ALTER TABLE "uploads" ADD CONSTRAINT "uploads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_avatarUploadId_fkey" FOREIGN KEY ("avatarUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
