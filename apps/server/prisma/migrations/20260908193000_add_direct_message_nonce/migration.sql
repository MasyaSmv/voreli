ALTER TABLE "messages" ADD COLUMN "clientNonce" TEXT;

CREATE UNIQUE INDEX "messages_directConversationId_authorId_clientNonce_key"
ON "messages"("directConversationId", "authorId", "clientNonce");
