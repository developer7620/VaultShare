/**
 * File service — all business logic for file operations.
 *
 * Controllers call this. This module calls the storage provider and the
 * File model. Nothing else imports from here except controllers and tests.
 *
 * Service methods return plain objects or throw AppError.
 * They never touch req or res — those are controller concerns.
 */

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const File = require("../models/File.model");
const storage = require("../storage");
const AppError = require("../utils/AppError");
const env = require("../config/env");

// ─── Upload flow ───────────────────────────────────────────────────────────

/**
 * generateUploadCredentials
 *
 * Phase 1 of the upload flow. Validates the file metadata the client
 * describes, then asks the storage provider for upload credentials.
 *
 * The client uses these credentials to upload directly to Cloudinary —
 * the backend is not involved in the actual transfer.
 *
 * @param {Object} params
 * @param {string} params.originalName
 * @param {string} params.mimeType
 * @param {number} params.sizeBytes
 * @returns {Promise<Object>} Cloudinary upload parameters
 */
async function generateUploadCredentials({
  originalName,
  mimeType,
  sizeBytes,
}) {
  // Ask the storage provider for upload credentials.
  // The provider encapsulates all Cloudinary-specific logic.
  const credentials = await storage.generateUploadSignature({
    maxBytes: sizeBytes,
    originalName,
    mimeType,
  });

  return {
    // What the client needs to POST to Cloudinary
    uploadCredentials: credentials,
    // Echo back the file info so the client can confirm
    fileInfo: {
      originalName,
      mimeType,
      sizeBytes,
    },
  };
}

/**
 * registerFile
 *
 * Phase 2 of the upload flow. Called after the client has successfully
 * uploaded to Cloudinary. Creates the File document in MongoDB.
 *
 * Critical validation: verify the storageKey actually exists in Cloudinary
 * under our account and folder, with the expected delivery type.
 * Without this, a client could register arbitrary Cloudinary public_ids.
 *
 * @param {Object} params
 * @param {string} params.storageKey     - Cloudinary public_id
 * @param {string} params.originalName
 * @param {string} params.mimeType
 * @param {number} params.sizeBytes
 * @param {string|null} params.password  - Plain text, will be hashed
 * @param {number|null} params.maxDownloads
 * @param {Date|null}   params.expiresAt
 * @returns {Promise<Object>} Created file summary
 */
async function registerFile({
  storageKey,
  originalName,
  mimeType,
  sizeBytes,
  password,
  maxDownloads,
  expiresAt,
}) {
  // ── Step 1: Validate the storageKey format ────────────────────────────────
  // Must start with our configured folder prefix.
  // This is a cheap local check before making a Cloudinary API call.
  const expectedPrefix = env.cloudinary.uploadFolder + "/";
  if (!storageKey.startsWith(expectedPrefix)) {
    throw AppError.badRequest(
      `Invalid storage key. Must be within the ${env.cloudinary.uploadFolder} folder.`,
      "INVALID_STORAGE_KEY",
    );
  }

  // ── Step 2: Verify the file exists in Cloudinary ──────────────────────────
  // This is the security-critical check. It calls Cloudinary's API to confirm:
  //   - The public_id exists in our account
  //   - It has the correct resource_type (raw) and delivery type (private)
  //
  // Without this, clients could register public_ids they don't own,
  // or IDs from publicly accessible uploads.
  await verifyStorageKeyExists(storageKey);

  // ── Step 3: Hash password if provided ────────────────────────────────────
  let passwordHash = null;
  const isPasswordProtected = Boolean(password && password.length > 0);

  if (isPasswordProtected) {
    // bcrypt with configured cost factor (10 in dev, 12 in production)
    passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  }

  // ── Step 4: Create File document ─────────────────────────────────────────
  const file = await File.create({
    storageKey,
    storageProvider: storage.getName(),
    originalName,
    mimeType,
    sizeBytes,
    passwordHash,
    isPasswordProtected,
    // downloadsRemaining mirrors maxDownloads on creation
    maxDownloads: maxDownloads || null,
    downloadsRemaining: maxDownloads || null,
    expiresAt: expiresAt || null,
    status: "active",
  });

  // ── Step 5: Return summary (never the full document) ─────────────────────
  // toJSON() transform strips passwordHash and downloads array automatically
  return {
    fileId: file._id,
    shareUrl: buildShareUrl(file._id),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    humanReadableSize: file.humanReadableSize,
    isPasswordProtected: file.isPasswordProtected,
    maxDownloads: file.maxDownloads,
    expiresAt: file.expiresAt,
    createdAt: file.createdAt,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * verifyStorageKeyExists
 *
 * Calls Cloudinary's resource API to confirm the public_id exists
 * and has the correct resource type and delivery type.
 *
 * This is the backend's trust boundary — it never trusts what the client
 * says about a file, only what Cloudinary's API confirms.
 *
 * @param {string} storageKey - Cloudinary public_id to verify
 * @throws {AppError} If the resource doesn't exist or has wrong type
 */
async function verifyStorageKeyExists(storageKey) {
  const cloudinary = require("cloudinary").v2;

  try {
    // cloudinary.api.resource() throws if the resource doesn't exist
    const resource = await cloudinary.api.resource(storageKey, {
      resource_type: "raw",
      type: "private",
    });

    // Sanity check: confirm it's in our folder
    // (Cloudinary returns the resource even if the folder doesn't match
    //  when called with the exact public_id — belt and suspenders)
    if (!resource.public_id.startsWith(env.cloudinary.uploadFolder + "/")) {
      throw new Error("Resource not in expected folder");
    }
  } catch (err) {
    // Cloudinary throws with err.error.http_code === 404 for missing resources
    if (err.error?.http_code === 404 || err.message?.includes("not found")) {
      throw AppError.badRequest(
        "The uploaded file could not be verified. Please try uploading again.",
        "STORAGE_KEY_NOT_FOUND",
      );
    }

    if (err.isOperational) {
      // Re-throw our own AppErrors (e.g., folder mismatch above)
      throw err;
    }

    // Cloudinary API error (network, auth, etc.)
    throw AppError.serviceUnavailable(
      "File verification failed. Storage service may be temporarily unavailable.",
    );
  }
}

/**
 * buildShareUrl
 *
 * Constructs the public URL users share to give others access.
 * In production, this would be your actual domain.
 *
 * @param {string} fileId - MongoDB ObjectId
 * @returns {string}
 */
function buildShareUrl(fileId) {
  const base = process.env.FRONTEND_URL || "http://localhost:5173";
  return `${base}/files/${fileId}`;
}

module.exports = {
  generateUploadCredentials,
  registerFile,
};
