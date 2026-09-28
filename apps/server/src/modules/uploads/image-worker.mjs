import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";

import sharp from "sharp";

// This entrypoint also runs directly from src under Vitest. tsc copies and checks it.
const pixelLimit = Number(process.argv[2]);
const processingSeconds = Number(process.argv[3]);
const inputLimit = Number(process.argv[4]);
if (
  ![pixelLimit, processingSeconds, inputLimit].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  )
) {
  throw new Error("Invalid image worker limits");
}
sharp.cache(false);
sharp.concurrency(1);

/** @type {Buffer[]} */
const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  /** @type {unknown} */
  const bytes = chunk;
  if (!Buffer.isBuffer(bytes)) throw new Error("Non-binary image input");
  length += bytes.length;
  if (length > inputLimit) throw new Error("Image input exceeds byte budget");
  chunks.push(bytes);
}
const image = sharp(Buffer.concat(chunks), {
  limitInputPixels: pixelLimit,
  pages: 1,
  failOn: "warning",
  sequentialRead: true,
});
try {
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions are missing");
  const thumbnail = await image
    .rotate()
    .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .timeout({ seconds: processingSeconds })
    .toBuffer();
  const header = Buffer.alloc(8);
  header.writeUInt32BE(metadata.width, 0);
  header.writeUInt32BE(metadata.height, 4);
  process.stdout.write(header);
  process.stdout.write(thumbnail);
} catch (error) {
  console.warn({ error, errorCode: "INVALID_IMAGE", operation: "image.decode" });
  process.exitCode = 2;
} finally {
  image.destroy();
}
