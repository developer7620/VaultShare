/**
 * File service — registration flow tests.
 */

"use strict";

const { setupDB } = require("../helpers/db");
const File = require("../../src/models/File.model");

jest.mock("../../src/storage", () => ({
  getName: () => "cloudinary",
  generateUploadSignature: jest.fn().mockResolvedValue({
    signature: "mock-sig",
    timestamp: 1234567890,
    apiKey: "mock-key",
    cloudName: "mock-cloud",
    folder: "vaultshare",
    resourceType: "raw",
    uploadType: "upload",
    uploadUrl: "https://api.cloudinary.com/v1_1/mock/raw/upload",
    maxBytes: 104857600,
  }),
  generateSignedDeliveryUrl: jest.fn().mockResolvedValue("https://mock-url"),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

setupDB();

// Override env to skip Cloudinary verification in tests
process.env.NODE_ENV = "development";

const fileService = require("../../src/services/file.service");

const VALID_PAYLOAD = {
  storageKey: "vaultshare/test-file-123",
  originalName: "document.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024 * 100,
  password: null,
  maxDownloads: null,
  expiresAt: null,
};

describe("registerFile", () => {
  test("creates a file document with correct fields", async () => {
    const result = await fileService.registerFile(VALID_PAYLOAD);

    expect(result.fileId).toBeDefined();
    expect(result.originalName).toBe("document.pdf");
    expect(result.isPasswordProtected).toBe(false);
    expect(result.maxDownloads).toBeNull();

    const doc = await File.findById(result.fileId);
    expect(doc).not.toBeNull();
    expect(doc.status).toBe("active");
    expect(doc.storageProvider).toBe("cloudinary");
  });

  test("returns uploadToken in response (plaintext, shown once)", async () => {
    const result = await fileService.registerFile(VALID_PAYLOAD);

    expect(result.uploadToken).toBeDefined();
    expect(result.uploadToken).toHaveLength(64); // 32 bytes hex
  });

  test("stores uploadTokenHash not plaintext in DB", async () => {
    const result = await fileService.registerFile(VALID_PAYLOAD);
    const doc = await File.findById(result.fileId);

    // DB has the hash
    expect(doc.uploadTokenHash).toBeDefined();
    // Hash is different from plaintext
    expect(doc.uploadTokenHash).not.toBe(result.uploadToken);
    // Plaintext is NOT in DB
    expect(doc.uploadTokenHash).not.toHaveLength(64);
  });

  test("hashes password when provided", async () => {
    const result = await fileService.registerFile({
      ...VALID_PAYLOAD,
      password: "mypassword",
    });

    const doc = await File.findById(result.fileId);
    expect(doc.passwordHash).toBeDefined();
    expect(doc.passwordHash).not.toBe("mypassword");
    expect(doc.isPasswordProtected).toBe(true);
  });

  test("sets downloadsRemaining equal to maxDownloads", async () => {
    const result = await fileService.registerFile({
      ...VALID_PAYLOAD,
      maxDownloads: 5,
    });

    const doc = await File.findById(result.fileId);
    expect(doc.downloadsRemaining).toBe(5);
    expect(doc.maxDownloads).toBe(5);
  });

  test("rejects storageKey outside vaultshare folder", async () => {
    await expect(
      fileService.registerFile({
        ...VALID_PAYLOAD,
        storageKey: "other-folder/file.pdf",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STORAGE_KEY",
      statusCode: 400,
    });
  });

  test("returns shareUrl containing fileId", async () => {
    const result = await fileService.registerFile(VALID_PAYLOAD);
    expect(result.shareUrl).toContain(result.fileId.toString());
  });
});
