/**
 * File routes — HTTP integration tests using supertest.
 *
 * Tests the full HTTP stack: middleware → controller → service → DB.
 * Storage is mocked — no Cloudinary calls.
 */

"use strict";

const request = require("supertest");
const { setupDB } = require("../helpers/db");
const {
  createActiveFile,
  createPasswordProtectedFile,
  createLimitedFile,
} = require("../helpers/factories");

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

jest.mock("../../src/storage/CloudinaryProvider", () => {
  return jest.fn().mockImplementation(() => ({
    generateSignedDeliveryUrl: jest.fn().mockResolvedValue("https://mock-url"),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  }));
});

process.env.NODE_ENV = "development";

const app = require("../../src/app");

setupDB();

// ─── GET /api/files/:id ────────────────────────────────────────────────────

describe("GET /api/files/:id", () => {
  test("200 with file metadata for active file", async () => {
    const file = await createActiveFile();

    const res = await request(app).get(`/api/files/${file._id}`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBe("test-file.pdf");
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  test("404 for non-existent file", async () => {
    const mongoose = require("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app).get(`/api/files/${fakeId}`).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  test("400 for invalid ObjectId format", async () => {
    const res = await request(app).get("/api/files/not-a-valid-id").expect(400);

    expect(res.body.error.code).toBe("INVALID_ID");
  });

  test("does not expose passwordHash in response", async () => {
    const file = await createPasswordProtectedFile("secret");

    const res = await request(app).get(`/api/files/${file._id}`).expect(200);

    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.isPasswordProtected).toBe(true);
  });
});

// ─── POST /api/files/:id/download ─────────────────────────────────────────

describe("POST /api/files/:id/download", () => {
  test("200 with signed URL for unprotected file", async () => {
    const file = await createActiveFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({})
      .expect(200);

    expect(res.body.data.signedUrl).toBe("https://mock-url");
  });

  test("401 with wrong password", async () => {
    const file = await createPasswordProtectedFile("correct");

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({ password: "wrong" })
      .expect(401);

    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("200 with correct password", async () => {
    const file = await createPasswordProtectedFile("correct");

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({ password: "correct" })
      .expect(200);

    expect(res.body.data.signedUrl).toBeDefined();
  });

  test("404 when download limit is exhausted", async () => {
    const file = await createLimitedFile(1, { downloadsRemaining: 0 });

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({})
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  test("response includes downloadsRemaining for limited files", async () => {
    const file = await createLimitedFile(5);

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({})
      .expect(200);

    expect(res.body.data.downloadsRemaining).toBe(4);
  });

  test("response includes urlExpiresInSeconds", async () => {
    const file = await createActiveFile();

    const res = await request(app)
      .post(`/api/files/${file._id}/download`)
      .send({})
      .expect(200);

    expect(res.body.data.urlExpiresInSeconds).toBeDefined();
    expect(typeof res.body.data.urlExpiresInSeconds).toBe("number");
  });
});

// ─── POST /api/files/sign ──────────────────────────────────────────────────

describe("POST /api/files/sign", () => {
  test("200 with upload credentials", async () => {
    const res = await request(app)
      .post("/api/files/sign")
      .send({
        originalName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024 * 100,
      })
      .expect(200);

    expect(res.body.data.uploadCredentials.signature).toBeDefined();
    expect(res.body.data.uploadCredentials.uploadUrl).toBeDefined();
  });

  test("400 with unsupported MIME type", async () => {
    const res = await request(app)
      .post("/api/files/sign")
      .send({
        originalName: "virus.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].field).toBe("mimeType");
  });

  test("400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/files/sign")
      .send({ mimeType: "application/pdf" })
      .expect(400);

    expect(res.body.error.details).toHaveLength(2); // originalName + sizeBytes
  });

  test("400 when file exceeds size limit", async () => {
    const res = await request(app)
      .post("/api/files/sign")
      .send({
        originalName: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 200 * 1024 * 1024, // 200MB — over 100MB limit
      })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── DELETE /api/files/:id ─────────────────────────────────────────────────

describe("DELETE /api/files/:id", () => {
  test("200 with valid upload token", async () => {
    // Register a file to get a real token
    const registerRes = await request(app)
      .post("/api/files/register")
      .send({
        storageKey: "vaultshare/test-delete-file",
        originalName: "to-delete.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      })
      .expect(201);

    const { fileId, uploadToken } = registerRes.body.data;

    const deleteRes = await request(app)
      .delete(`/api/files/${fileId}`)
      .set("Authorization", `Bearer ${uploadToken}`)
      .expect(200);

    expect(deleteRes.body.data.message).toContain("deleted");
  });

  test("401 without upload token", async () => {
    const file = await createActiveFile({ uploadTokenHash: "some-hash" });

    const res = await request(app).delete(`/api/files/${file._id}`).expect(401);

    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
