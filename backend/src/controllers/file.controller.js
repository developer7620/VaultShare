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

module.exports = { sign, register };
