CREATE TYPE "DirectCallStatus" AS ENUM (
  'RINGING',
  'ACTIVE',
  'DECLINED',
  'CANCELLED',
  'MISSED',
  'ENDED'
);

CREATE TABLE "direct_calls" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "callerId" TEXT NOT NULL,
  "calleeId" TEXT NOT NULL,
  "callerSessionId" TEXT NOT NULL,
  "clientNonce" TEXT NOT NULL,
  "status" "DirectCallStatus" NOT NULL,
  "answeredSessionId" TEXT,
  "historyMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endedById" TEXT,

  CONSTRAINT "direct_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_calls_participants_check" CHECK ("callerId" <> "calleeId")
);

CREATE UNIQUE INDEX "direct_calls_callerSessionId_clientNonce_key"
  ON "direct_calls"("callerSessionId", "clientNonce");
CREATE UNIQUE INDEX "direct_calls_historyMessageId_key" ON "direct_calls"("historyMessageId");
CREATE UNIQUE INDEX "direct_calls_one_unfinished_conversation"
  ON "direct_calls"("conversationId") WHERE "status" IN ('RINGING', 'ACTIVE');
CREATE INDEX "direct_calls_conversationId_createdAt_id_idx"
  ON "direct_calls"("conversationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "direct_calls_calleeId_status_createdAt_idx"
  ON "direct_calls"("calleeId", "status", "createdAt" DESC);
CREATE INDEX "direct_calls_callerId_status_createdAt_idx"
  ON "direct_calls"("callerId", "status", "createdAt" DESC);

ALTER TABLE "direct_calls" ADD CONSTRAINT "direct_calls_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_calls" ADD CONSTRAINT "direct_calls_callerId_fkey"
  FOREIGN KEY ("callerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_calls" ADD CONSTRAINT "direct_calls_calleeId_fkey"
  FOREIGN KEY ("calleeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_calls" ADD CONSTRAINT "direct_calls_endedById_fkey"
  FOREIGN KEY ("endedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_calls" ADD CONSTRAINT "direct_calls_historyMessageId_fkey"
  FOREIGN KEY ("historyMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
