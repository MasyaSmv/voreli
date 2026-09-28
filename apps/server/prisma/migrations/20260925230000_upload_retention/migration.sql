ALTER TABLE "uploads"
  ADD COLUMN "stagingDeletedAt" TIMESTAMP(3),
  ADD COLUMN "unreferencedAt" TIMESTAMP(3);

-- The old marker described staging deletion, sometimes before DELETE even succeeded.
UPDATE "uploads" SET "objectDeletedAt" = NULL;
UPDATE "uploads" SET "unreferencedAt" = COALESCE("completedAt", "reservedAt")
WHERE "status" = 'READY'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "avatarUploadId" = "uploads"."id")
  AND NOT EXISTS (SELECT 1 FROM "attachments" WHERE "uploadId" = "uploads"."id");

CREATE INDEX "uploads_status_unreferencedAt_idx" ON "uploads"("status", "unreferencedAt");
