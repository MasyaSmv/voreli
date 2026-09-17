-- CreateEnum
CREATE TYPE "ContactAudience" AS ENUM ('EVERYONE', 'FRIENDS', 'NOBODY');

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "directConversationId" TEXT;
ALTER TABLE "messages" ALTER COLUMN "channelId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_contact_settings" (
    "userId" TEXT NOT NULL,
    "directMessageAudience" "ContactAudience" NOT NULL DEFAULT 'EVERYONE',
    "directCallAudience" "ContactAudience" NOT NULL DEFAULT 'EVERYONE',
    "friendRequestAudience" "ContactAudience" NOT NULL DEFAULT 'EVERYONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_contact_settings_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "friend_requests" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "FriendRequestStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "friend_requests_canonical_pair" CHECK ("userLowId" < "userHighId"),
    CONSTRAINT "friend_requests_requester_in_pair" CHECK ("requesterId" = "userLowId" OR "requesterId" = "userHighId")
);

CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "friendships_canonical_pair" CHECK ("userLowId" < "userHighId")
);

CREATE TABLE "user_blocks" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blockerId", "blockedId"),
    CONSTRAINT "user_blocks_not_self" CHECK ("blockerId" <> "blockedId")
);

CREATE TABLE "direct_conversations" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_conversations_canonical_pair" CHECK ("userLowId" < "userHighId")
);

CREATE TABLE "direct_conversation_reads" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "direct_conversation_reads_pkey" PRIMARY KEY ("conversationId", "userId")
);

-- CreateIndex
CREATE INDEX "friend_requests_userLowId_status_idx" ON "friend_requests"("userLowId", "status");
CREATE INDEX "friend_requests_userHighId_status_idx" ON "friend_requests"("userHighId", "status");
CREATE UNIQUE INDEX "friend_requests_pending_pair_key" ON "friend_requests"("userLowId", "userHighId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "friendships_userLowId_userHighId_key" ON "friendships"("userLowId", "userHighId");
CREATE INDEX "friendships_userHighId_idx" ON "friendships"("userHighId");
CREATE INDEX "user_blocks_blockedId_idx" ON "user_blocks"("blockedId");
CREATE UNIQUE INDEX "direct_conversations_userLowId_userHighId_key" ON "direct_conversations"("userLowId", "userHighId");
CREATE INDEX "direct_conversations_userHighId_idx" ON "direct_conversations"("userHighId");
CREATE INDEX "direct_conversation_reads_userId_updatedAt_idx" ON "direct_conversation_reads"("userId", "updatedAt");
CREATE INDEX "direct_conversation_reads_lastReadMessageId_idx" ON "direct_conversation_reads"("lastReadMessageId");
CREATE INDEX "messages_directConversationId_createdAt_id_idx" ON "messages"("directConversationId", "createdAt" DESC, "id" DESC);

-- The application never permits a message without a container or with two containers.
ALTER TABLE "messages" ADD CONSTRAINT "messages_exactly_one_container" CHECK (("channelId" IS NOT NULL) <> ("directConversationId" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "user_contact_settings" ADD CONSTRAINT "user_contact_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_reads" ADD CONSTRAINT "direct_conversation_reads_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_reads" ADD CONSTRAINT "direct_conversation_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_reads" ADD CONSTRAINT "direct_conversation_reads_lastReadMessageId_fkey" FOREIGN KEY ("lastReadMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_directConversationId_fkey" FOREIGN KEY ("directConversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
