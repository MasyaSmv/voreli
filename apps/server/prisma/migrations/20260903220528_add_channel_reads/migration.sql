-- CreateTable
CREATE TABLE "channel_reads" (
    "memberId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_reads_pkey" PRIMARY KEY ("memberId","channelId")
);

-- CreateIndex
CREATE INDEX "channel_reads_channelId_idx" ON "channel_reads"("channelId");

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
