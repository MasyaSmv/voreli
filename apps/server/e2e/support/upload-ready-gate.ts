import type { PrismaClient } from "@prisma/client";

/** Real PostgreSQL contention: lets the worker enter PROCESSING but holds its READY write. */
export async function holdUploadReady(prisma: PrismaClient, ownerId: string) {
  if (!/^[a-f0-9-]+$/.test(ownerId)) throw new Error("Expected a fixture UUID");
  const name = `upload_gate_${ownerId.replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(1010, hashtext(NEW."ownerId")); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE UPDATE ON "uploads"
    FOR EACH ROW WHEN (NEW."ownerId" = '${ownerId}' AND NEW."status" = 'READY')
    EXECUTE FUNCTION "${name}"()`);
  let unlock: () => void = () => {
    throw new Error("Gate is not open");
  };
  const released = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let running: Promise<void>;
  await new Promise<void>((ready, failed) => {
    running = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1010, hashtext(${ownerId}))`;
        ready();
        await released;
      },
      { timeout: 40_000 },
    );
    void running.catch(failed);
  });
  return async () => {
    unlock();
    await running;
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "uploads"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
  };
}
