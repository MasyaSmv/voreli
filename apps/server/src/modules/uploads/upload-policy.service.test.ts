import { describe, expect, it } from "vitest";

import { UnsupportedUploadTypeError, UploadTooLargeError } from "./errors/upload-errors.js";
import { UploadPolicyService } from "./upload-policy.service.js";

describe("UploadPolicyService", () => {
  const policy = new UploadPolicyService();

  it("requires extension, declared MIME and purpose to agree", () => {
    expect(() => policy.validateReservation("photo.png", "image/png", 10, "AVATAR")).not.toThrow();
    expect(() => policy.validateReservation("photo.jpg", "image/png", 10, "ATTACHMENT")).toThrow(
      UnsupportedUploadTypeError,
    );
    expect(() =>
      policy.validateReservation("archive.zip", "application/zip", 10, "AVATAR"),
    ).toThrow(UnsupportedUploadTypeError);
  });

  it("keeps the avatar limit below the attachment limit", () => {
    expect(() =>
      policy.validateReservation("photo.png", "image/png", 6 * 1024 * 1024, "AVATAR"),
    ).toThrow(UploadTooLargeError);
    expect(() =>
      policy.validateReservation("photo.png", "image/png", 6 * 1024 * 1024, "ATTACHMENT"),
    ).not.toThrow();
  });

  it("rejects a detected type that disagrees with reservation", () => {
    expect(() => policy.validateDetected("photo.png", "image/png", "image/jpeg")).toThrow(
      UnsupportedUploadTypeError,
    );
  });
});
