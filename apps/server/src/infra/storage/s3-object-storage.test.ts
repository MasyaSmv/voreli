import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { validateEnv, type EnvironmentVariables } from "../../config/env.validation.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

describe("S3ObjectStorage browser URLs", () => {
  it("signs downloads for the public origin while the storage client uses loopback", async () => {
    const config = new ConfigService<EnvironmentVariables, true>(
      validateEnv({
        DATABASE_URL: "postgresql://voreli:voreli@localhost:5432/voreli",
        JWT_SECRET: "a-secret-that-is-at-least-32-characters",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_PUBLIC_ENDPOINT: "https://storage.example.com",
      }),
    );
    const storage = new S3ObjectStorage(config);

    try {
      const signed = new URL(
        await storage.presignDownload("avatars/test.webp", "test.webp", "image/webp", 60),
      );
      expect(signed.origin).toBe("https://storage.example.com");
      expect(signed.pathname).toBe("/voreli/avatars/test.webp");
      expect(signed.searchParams.has("X-Amz-Signature")).toBe(true);
    } finally {
      storage.onModuleDestroy();
    }
  });
});
