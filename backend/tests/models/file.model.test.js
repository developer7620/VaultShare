/**
 * File model tests.
 *
 * Tests the business logic baked into the model:
 * virtuals, instance methods, and static finders.
 *
 * These tests run against the real Mongoose schema — they catch
 * schema validation errors and virtual computation bugs.
 */

"use strict";

const { setupDB } = require("../helpers/db");
const {
  createActiveFile,
  createPasswordProtectedFile,
  createLimitedFile,
  createExpiredFile,
  createExpiringFile,
} = require("../helpers/factories");
const File = require("../../src/models/File.model");

setupDB();

describe("File model — virtuals", () => {
  test("isExpired is false for file with no expiresAt", async () => {
    const file = await createActiveFile({ expiresAt: null });
    expect(file.isExpired).toBe(false);
  });

  test("isExpired is false for file expiring in the future", async () => {
    const file = await createExpiringFile(60000); // 1 minute from now
    expect(file.isExpired).toBe(false);
  });

  test("isExpired is true for file past its expiresAt", async () => {
    const file = await createExpiredFile();
    expect(file.isExpired).toBe(true);
  });

  test("isDownloadLimitReached is false for unlimited file", async () => {
    const file = await createActiveFile({ maxDownloads: null });
    expect(file.isDownloadLimitReached).toBe(false);
  });

  test("isDownloadLimitReached is false when downloads remain", async () => {
    const file = await createLimitedFile(5);
    expect(file.isDownloadLimitReached).toBe(false);
  });

  test("isDownloadLimitReached is true when downloadsRemaining is 0", async () => {
    const file = await createLimitedFile(3, { downloadsRemaining: 0 });
    expect(file.isDownloadLimitReached).toBe(true);
  });

  test("humanReadableSize formats bytes correctly", async () => {
    const kb = await createActiveFile({ sizeBytes: 2048 });
    expect(kb.humanReadableSize).toBe("2.0 KB");

    const mb = await createActiveFile({ sizeBytes: 5 * 1024 * 1024 });
    expect(mb.humanReadableSize).toBe("5.0 MB");

    const bytes = await createActiveFile({ sizeBytes: 512 });
    expect(bytes.humanReadableSize).toBe("512 B");
  });
});

describe("File model — canBeDownloaded()", () => {
  test("returns allowed:true for a clean active file", async () => {
    const file = await createActiveFile();
    const { allowed, reason } = file.canBeDownloaded();
    expect(allowed).toBe(true);
    expect(reason).toBeNull();
  });

  test("returns allowed:false with FILE_INACTIVE for deleted file", async () => {
    const file = await createActiveFile({ status: "deleted" });
    const { allowed, reason } = file.canBeDownloaded();
    expect(allowed).toBe(false);
    expect(reason).toBe("FILE_INACTIVE");
  });

  test("returns allowed:false with FILE_EXPIRED for expired file", async () => {
    const file = await createExpiredFile();
    const { allowed, reason } = file.canBeDownloaded();
    expect(allowed).toBe(false);
    expect(reason).toBe("FILE_EXPIRED");
  });

  test("returns allowed:false with DOWNLOAD_LIMIT_REACHED when at zero", async () => {
    const file = await createLimitedFile(3, { downloadsRemaining: 0 });
    const { allowed, reason } = file.canBeDownloaded();
    expect(allowed).toBe(false);
    expect(reason).toBe("DOWNLOAD_LIMIT_REACHED");
  });

  test("expiry takes precedence over download limit", async () => {
    const file = await createExpiredFile({
      maxDownloads: 5,
      downloadsRemaining: 5,
    });
    const { allowed, reason } = file.canBeDownloaded();
    expect(allowed).toBe(false);
    expect(reason).toBe("FILE_EXPIRED");
  });
});

describe("File model — toJSON transform", () => {
  test("strips passwordHash from JSON output", async () => {
    const file = await createPasswordProtectedFile();
    const json = file.toJSON();
    expect(json.passwordHash).toBeUndefined();
  });

  test("strips uploadTokenHash from JSON output", async () => {
    const file = await createActiveFile({ uploadTokenHash: "some-hash" });
    const json = file.toJSON();
    expect(json.uploadTokenHash).toBeUndefined();
  });

  test("strips downloads audit array from JSON output", async () => {
    const file = await createActiveFile();
    file.downloads.push({ downloadedAt: new Date(), ipHash: "abc123" });
    await file.save();
    const json = file.toJSON();
    expect(json.downloads).toBeUndefined();
  });

  test("includes virtual fields in JSON output", async () => {
    const file = await createActiveFile();
    const json = file.toJSON();
    expect(json.isExpired).toBeDefined();
    expect(json.humanReadableSize).toBeDefined();
  });
});

describe("File model — static finders", () => {
  test("findByIdActive returns active file", async () => {
    const file = await createActiveFile();
    const found = await File.findByIdActive(file._id);
    expect(found).not.toBeNull();
    expect(found._id.toString()).toBe(file._id.toString());
  });

  test("findByIdActive returns null for deleted file", async () => {
    const file = await createActiveFile({ status: "deleted" });
    const found = await File.findByIdActive(file._id);
    expect(found).toBeNull();
  });

  test("findByIdActive returns null for expired file (status)", async () => {
    const file = await createActiveFile({ status: "expired" });
    const found = await File.findByIdActive(file._id);
    expect(found).toBeNull();
  });

  test("findByIdActive returns null for non-existent ID", async () => {
    const mongoose = require("mongoose");
    const fakeId = new mongoose.Types.ObjectId();
    const found = await File.findByIdActive(fakeId);
    expect(found).toBeNull();
  });

  test("findExpiredActive returns files past expiresAt", async () => {
    await createExpiredFile(); // should be returned
    await createExpiringFile(60000); // should NOT be returned
    await createActiveFile(); // should NOT be returned

    const expired = await File.findExpiredActive();
    expect(expired).toHaveLength(1);
  });
});
