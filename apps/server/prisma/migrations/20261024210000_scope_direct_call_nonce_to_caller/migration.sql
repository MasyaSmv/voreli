BEGIN;

LOCK TABLE "direct_calls" IN SHARE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "direct_calls"
    GROUP BY "callerId", "clientNonce"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate direct call clientNonce per caller must be resolved before migration';
  END IF;
END $$;

DROP INDEX "direct_calls_callerSessionId_clientNonce_key";
CREATE UNIQUE INDEX "direct_calls_callerId_clientNonce_key" ON "direct_calls"("callerId", "clientNonce");
CREATE INDEX "direct_calls_callerSessionId_idx" ON "direct_calls"("callerSessionId");
CREATE INDEX "direct_calls_answeredSessionId_idx" ON "direct_calls"("answeredSessionId");

COMMIT;
