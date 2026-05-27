/**
 * File controller — HTTP request/response handling only.
 *
 * Rules enforced here:
 *   1. Never import mongoose models directly
 *   2. Never import the storage provider directly
 *   3. Never contain business logic (conditionals about file state, etc.)
 *   4. Always use asyncHandler (no raw try/catch)
 *   5. Always send a consistent response shape
 *
 * If a controller method exceeds ~25 lines, business logic has leaked in.
 * Move it to the service.
 */

"use strict";

const fileService = require("../services/file.service");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/files/sign
 *
 * Generate Cloudinary upload credentials for direct client-side upload.
 * The client sends file metadata; we return a signature + upload URL.
 *
 * Request body: { originalName, mimeType, sizeBytes }
 * Response: { uploadCredentials: { ... }, fileInfo: { ... } }
 */
const sign = asyncHandler(async (req, res) => {
  const { originalName, mimeType, sizeBytes } = req.body;

  const result = await fileService.generateUploadCredentials({
    originalName,
    mimeType,
    sizeBytes,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/files/register
 *
 * Register a file after the client has uploaded it to Cloudinary.
 * Validates the storageKey, hashes password, creates DB document.
 *
 * Request body: { storageKey, originalName, mimeType, sizeBytes,
 *                 password?, maxDownloads?, expiresAt? }
 * Response: { fileId, shareUrl, originalName, ... }
 */
const register = asyncHandler(async (req, res) => {
  const {
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    password,
    maxDownloads,
    expiresAt,
  } = req.body;

  const result = await fileService.registerFile({
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    password,
    maxDownloads,
    expiresAt,
  });

  // 201 Created — a new File resource was created
  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * Add to file.controller.js — below existing sign and register controllers
 */

/**
 * GET /api/files/:id
 *
 * Returns public file metadata for the download page.
 * No authentication required — reveals only non-sensitive fields.
 * Does NOT generate a signed URL or decrement any counter.
 *
 * Request params: { id: MongoDB ObjectId }
 * Response: { fileId, originalName, mimeType, sizeBytes,
 *             isPasswordProtected, downloadsRemaining, expiresAt }
 */
const getMeta = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await fileService.getFileMeta(id);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/files/:id/download
 *
 * Verifies access (password, limits, expiry) and returns a short-lived
 * signed URL. Atomically decrements the download counter.
 *
 * Request params: { id: MongoDB ObjectId }
 * Request body:   { password?: string }
 * Response:       { signedUrl, originalName, mimeType,
 *                   downloadsRemaining, urlExpiresInSeconds }
 */
const download = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  // Extract client IP for audit logging.
  // req.ip respects Express's 'trust proxy' setting.
  // In production behind a load balancer, set app.set('trust proxy', 1)
  // and req.ip will return the real client IP from X-Forwarded-For.
  const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
  const userAgent = req.headers["user-agent"] || "";

  const result = await fileService.downloadFile({
    fileId: id,
    password: password || null,
    ipAddress,
    userAgent,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// Update module.exports to include new controllers:
module.exports = { sign, register, getMeta, download };
