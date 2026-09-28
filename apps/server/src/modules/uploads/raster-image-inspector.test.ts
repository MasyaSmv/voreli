import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { LinuxBoundedProcess } from "../../infra/process/linux-bounded-process.js";

import { RasterImageInspector } from "./raster-image-inspector.js";

describe("RasterImageInspector", () => {
  const processHost = new LinuxBoundedProcess();
  const inspector = new RasterImageInspector(processHost);
  afterAll(() => processHost.onModuleDestroy());

  it("rotates and bounds previews while stripping EXIF and ICC metadata", async () => {
    const bytes = await sharp({
      create: { width: 2_400, height: 1_200, channels: 3, background: "red" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const result = await inspector.inspect("image", bytes);
    expect(result).toMatchObject({ width: 2_400, height: 1_200 });
    const preview = await sharp(result.thumbnail).metadata();
    expect(preview).toMatchObject({ format: "webp", width: 800, height: 1_600 });
    expect(preview.exif).toBeUndefined();
    expect(preview.icc).toBeUndefined();
    expect(preview.orientation).toBeUndefined();
  });

  it("does not enlarge small images", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 8, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    const result = await inspector.inspect("small", bytes);
    expect(await sharp(result.thumbnail).metadata()).toMatchObject({ width: 16, height: 8 });
  });

  it("rejects an image exceeding the decoded pixel budget", async () => {
    const bytes = await sharp({
      create: { width: 6_400, height: 6_400, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(inspector.inspect("oversized", bytes)).rejects.toMatchObject({
      rejectionCode: "INVALID_IMAGE",
    });
  });

  it("rejects truncated image data", async () => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await expect(inspector.inspect("truncated", bytes.subarray(0, 50))).rejects.toMatchObject({
      rejectionCode: "INVALID_IMAGE",
    });
  });
});
