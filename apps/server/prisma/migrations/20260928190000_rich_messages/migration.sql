CREATE TABLE "message_reactions" (
  "messageId" TEXT NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("messageId", "userId", "emoji")
);
CREATE INDEX "message_reactions_messageId_emoji_idx" ON "message_reactions"("messageId", "emoji");
CREATE INDEX "message_reactions_userId_idx" ON "message_reactions"("userId");
CREATE UNIQUE INDEX "messages_channelId_authorId_clientNonce_key" ON "messages"("channelId", "authorId", "clientNonce");
