BEGIN;

LOCK TABLE "messages" IN SHARE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "messages"
    WHERE "clientNonce" IS NOT NULL
    GROUP BY "authorId", "clientNonce"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate message clientNonce per author must be resolved before migration';
  END IF;
END $$;

DROP INDEX "messages_directConversationId_authorId_clientNonce_key";
DROP INDEX "messages_channelId_authorId_clientNonce_key";
CREATE UNIQUE INDEX "messages_authorId_clientNonce_key" ON "messages"("authorId", "clientNonce");

COMMIT;
