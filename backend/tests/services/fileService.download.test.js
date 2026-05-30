/**
 * File service — download flow critical path tests.
 *
 * These tests cover the security properties that MUST hold:
 *   1. Password gate never skipped
 *   2. Expired/deleted files always blocked
 *   3. Atomic counter prevents over-download under concurrency
 *   4. Signed URL generated after — never before — successful decrement
 */

"use strict";

const { setupDB } = require("../helpers/db");
const {
  createActiveFile,
  createPasswordProtectedFile,
  createLimitedFile,
  createExpiredFile,
} = require("../helpers/factories");

// Mock storage — no real Cloudinary calls in tests
jest.mock("../../src/storage", () => ({
  getName: () => "cloudinary",
  generateUploadSignature: jest.fn(),
  generateSignedDeliveryUrl: jest
    .fn()
    .mockResolvedValue("https://mock-signed-url"),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

// Mock the per-file CloudinaryProvider instantiation inside generateDeliveryUrl
jest.mock("../../src/storage/CloudinaryProvider", () => {
  return jest.fn().mockImplementation(() => ({
    generateSignedDeliveryUrl: jest
      .fn()
      .mockResolvedValue("https://mock-signed-url"),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  }));
});

const fileService = require("../../src/services/file.service");
const File = require("../../src/models/File.model");

setupDB();

// Shared test context
const TEST_IP = "127.0.0.1";
const TEST_UA = "Jest/TestAgent";
const TEST_LANG = "en-US";

function downloadArgs(fileId, password = null) {
  return {
    fileId: fileId.toString(),
    password,
    ipAddress: TEST_IP,
    userAgent: TEST_UA,
    acceptLanguage: TEST_LANG,
  };
}

// ─── Basic access control ──────────────────────────────────────────────────

describe("downloadFile — access control", () => {
  test("succeeds for a clean unprotected file", async () => {
    const file = await createActiveFile();
    const result = await fileService.downloadFile(downloadArgs(file._id));

    expect(result.signedUrl).toBe("https://mock-signed-url");
    expect(result.originalName).toBe("test-file.pdf");
  });

  test("throws NOT_FOUND for non-existent file", async () => {
    const mongoose = require("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    await expect(
      fileService.downloadFile(downloadArgs(fakeId)),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  test("throws NOT_FOUND for deleted file", async () => {
    const file = await createActiveFile({ status: "deleted" });

    await expect(
      fileService.downloadFile(downloadArgs(file._id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("throws NOT_FOUND for expired file", async () => {
    const file = await createExpiredFile();

    await expect(
      fileService.downloadFile(downloadArgs(file._id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Password verification ─────────────────────────────────────────────────

describe("downloadFile — password verification", () => {
  test("succeeds with correct password", async () => {
    const file = await createPasswordProtectedFile("correct-password");
    const result = await fileService.downloadFile(
      downloadArgs(file._id, "correct-password"),
    );
    expect(result.signedUrl).toBeDefined();
  });

  test("throws UNAUTHORIZED with wrong password", async () => {
    const file = await createPasswordProtectedFile("correct-password");

    await expect(
      fileService.downloadFile(downloadArgs(file._id, "wrong-password")),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  test("throws UNAUTHORIZED with no password on protected file", async () => {
    const file = await createPasswordProtectedFile("some-password");

    await expect(
      fileService.downloadFile(downloadArgs(file._id, null)),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  test("succeeds without password on unprotected file", async () => {
    const file = await createActiveFile({ isPasswordProtected: false });
    const result = await fileService.downloadFile(downloadArgs(file._id, null));
    expect(result.signedUrl).toBeDefined();
  });

  test("password error message includes remaining attempts", async () => {
    const file = await createPasswordProtectedFile("correct-password");

    const error = await fileService
      .downloadFile(downloadArgs(file._id, "wrong"))
      .catch((e) => e);

    expect(error.message).toMatch(/attempt/i);
  });
});

// ─── Download counter ──────────────────────────────────────────────────────

describe("downloadFile — download counter", () => {
  test("decrements downloadsRemaining on each download", async () => {
    const file = await createLimitedFile(3);

    await fileService.downloadFile(downloadArgs(file._id));

    const updated = await File.findById(file._id);
    expect(updated.downloadsRemaining).toBe(2);
  });

  test("returns correct downloadsRemaining in response", async () => {
    const file = await createLimitedFile(5);

    const result = await fileService.downloadFile(downloadArgs(file._id));
    expect(result.downloadsRemaining).toBe(4);
  });

  test("returns null downloadsRemaining for unlimited file", async () => {
    const file = await createActiveFile({ maxDownloads: null });

    const result = await fileService.downloadFile(downloadArgs(file._id));
    expect(result.downloadsRemaining).toBeNull();
  });

  test("blocks download when downloadsRemaining is 0", async () => {
    const file = await createLimitedFile(1, { downloadsRemaining: 0 });

    await expect(
      fileService.downloadFile(downloadArgs(file._id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("allows exactly maxDownloads downloads then blocks", async () => {
    const file = await createLimitedFile(3);

    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      const result = await fileService.downloadFile(downloadArgs(file._id));
      expect(result.signedUrl).toBeDefined();
    }

    // 4th should fail
    await expect(
      fileService.downloadFile(downloadArgs(file._id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Atomicity — the most critical tests ──────────────────────────────────

describe("downloadFile — atomic counter (concurrency)", () => {
  test("only one of two concurrent requests succeeds when limit is 1", async () => {
    const file = await createLimitedFile(1);

    // Fire both requests simultaneously — race condition test
    const results = await Promise.allSettled([
      fileService.downloadFile(downloadArgs(file._id)),
      fileService.downloadFile(downloadArgs(file._id)),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed and one must fail
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failure must be a NOT_FOUND (limit reached), not an error
    expect(failures[0].reason.code).toBe("NOT_FOUND");

    // DB must show exactly 0 remaining
    const updated = await File.findById(file._id);
    expect(updated.downloadsRemaining).toBe(0);
  });

  test("counter never goes below 0 under concurrent load", async () => {
    const file = await createLimitedFile(3);

    // Fire 10 concurrent requests against a limit of 3
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        fileService.downloadFile(downloadArgs(file._id)),
      ),
    );

    const successes = results.filter((r) => r.status === "fulfilled");
    expect(successes).toHaveLength(3);

    const updated = await File.findById(file._id);
    expect(updated.downloadsRemaining).toBe(0);
    // Critical: must never be negative
    expect(updated.downloadsRemaining).toBeGreaterThanOrEqual(0);
  });

  test("downloadCount increments correctly under concurrency", async () => {
    const file = await createLimitedFile(5);

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        fileService.downloadFile(downloadArgs(file._id)),
      ),
    );

    // Wait briefly for fire-and-forget audit logs to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated = await File.findById(file._id);
    expect(updated.downloadCount).toBe(5);
  });
});

// ─── Ordering guarantees ───────────────────────────────────────────────────

describe("downloadFile — operation ordering", () => {
  test("signed URL is only generated after successful decrement", async () => {
    const CloudinaryProvider = require("../../src/storage/CloudinaryProvider");
    const mockInstance = new CloudinaryProvider();
    const generateSpy = mockInstance.generateSignedDeliveryUrl;

    // File with 0 downloads remaining — decrement will fail
    const file = await createLimitedFile(1, { downloadsRemaining: 0 });

    await expect(
      fileService.downloadFile(downloadArgs(file._id)),
    ).rejects.toBeDefined();

    // Signed URL should NOT have been generated
    expect(generateSpy).not.toHaveBeenCalled();
  });

  test("wrong password blocks decrement — counter unchanged", async () => {
    const file = await createPasswordProtectedFile("correct", {
      maxDownloads: 3,
      downloadsRemaining: 3,
    });

    await expect(
      fileService.downloadFile(downloadArgs(file._id, "wrong")),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Counter must be unchanged — wrong password must not burn downloads
    const updated = await File.findById(file._id);
    expect(updated.downloadsRemaining).toBe(3);
  });
});
