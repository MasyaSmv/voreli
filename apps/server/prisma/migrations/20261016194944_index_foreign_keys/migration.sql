-- CreateIndex
CREATE INDEX "channel_overrides_roleId_idx" ON "channel_overrides"("roleId");

-- CreateIndex
CREATE INDEX "channel_overrides_memberId_idx" ON "channel_overrides"("memberId");

-- CreateIndex
CREATE INDEX "direct_calls_endedById_idx" ON "direct_calls"("endedById");

-- CreateIndex
CREATE INDEX "friend_requests_requesterId_idx" ON "friend_requests"("requesterId");

-- CreateIndex
CREATE INDEX "invites_createdById_idx" ON "invites"("createdById");
