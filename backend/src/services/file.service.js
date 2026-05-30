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
const { generateUploadToken, verifyUploadToken } = require("../utils/token");
const attemptTracker = require("../utils/attemptTracker");
const { hashIp } = require("../utils/hash");

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
  // ── Step 1: Validate storageKey format ────────────────────────────────
  const expectedPrefix = env.cloudinary.uploadFolder + "/";
  if (!storageKey.startsWith(expectedPrefix)) {
    throw AppError.badRequest(
      `Invalid storage key. Must be within the ${env.cloudinary.uploadFolder} folder.`,
      "INVALID_STORAGE_KEY",
    );
  }

  // ── Step 2: Verify file exists in Cloudinary ──────────────────────────
  await verifyStorageKeyExists(storageKey);

  // ── Step 3: Hash password if provided ────────────────────────────────
  let passwordHash = null;
  const isPasswordProtected = Boolean(password && password.length > 0);
  if (isPasswordProtected) {
    passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  }

  // ── Step 4: Generate upload token ────────────────────────────────────
  // Generated for every file — required for deletion.
  // plaintext is returned to client once. hash is stored in DB.
  const { plaintext: uploadToken, hash: uploadTokenHash } =
    await generateUploadToken();

  // ── Step 5: Create File document ─────────────────────────────────────
  const file = await File.create({
    storageKey,
    storageProvider: storage.getName(),
    originalName,
    mimeType,
    sizeBytes,
    passwordHash,
    isPasswordProtected,
    uploadTokenHash, // ← stored, never returned directly
    maxDownloads: maxDownloads || null,
    downloadsRemaining: maxDownloads || null,
    expiresAt: expiresAt || null,
    status: "active",
  });

  // ── Step 6: Return summary including plaintext token ─────────────────
  // uploadToken is returned ONCE here and never again.
  // If the user loses it, they cannot delete the file — by design.
  return {
    fileId: file._id,
    uploadToken, // ← plaintext, shown once
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

/**
 * file.service.js — add to existing file, below registerFile
 *
 * New exports added today:
 *   - getFileMeta      → GET /api/files/:id
 *   - downloadFile     → POST /api/files/:id/download
 */

/**
 * Dummy bcrypt hash used for timing-attack-resistant password comparisons.
 *
 * When a file has no password, we still run bcrypt.compare() against this
 * dummy hash so the response time is identical to a file that does have a
 * password. Without this, an attacker can detect "no password" vs
 * "wrong password" by measuring response latency.
 *
 * The hash is for the string "dummy" at cost factor 12.
 * It must be a valid bcrypt hash — bcrypt.compare() validates format.
 */
const DUMMY_HASH =
  "$2b$12$LIxGCHaJ9SmhIkWsVxNdOeXPdSiGGfJj1z5Xv2V8k9Y3mR7nQpWuC";

// ─── Download flow ─────────────────────────────────────────────────────────

/**
 * getFileMeta
 *
 * Returns public metadata about a file without triggering a download.
 * Used by the frontend to render the download page.
 *
 * Deliberately omits: passwordHash, downloads audit array, storageKey.
 * Includes: whether a password is required (so the UI shows the input).
 *
 * Returns the same 404 whether the file doesn't exist OR is expired/deleted.
 * This prevents enumeration: an attacker can't distinguish "never existed"
 * from "existed but expired" by probing IDs.
 *
 * @param {string} fileId - MongoDB ObjectId string
 * @returns {Promise<Object>} Public file metadata
 */
async function getFileMeta(fileId) {
  // findByIdActive only returns status: 'active' files
  const file = await File.findByIdActive(fileId);

  if (!file) {
    throw AppError.notFound(
      "File not found. It may have expired or been deleted.",
    );
  }

  // Check expiry and limit using the model's instance method.
  // Even if status is 'active', the file might have passed its expiresAt
  // (the cron job hasn't run yet). The virtual isExpired handles this gap.
  const { allowed, reason } = file.canBeDownloaded();
  if (!allowed) {
    throw AppError.notFound(
      "File not found. It may have expired or been deleted.",
    );
    // Note: we return 404 (not 410 Gone) even for expired files.
    // 410 would confirm the file existed, enabling enumeration.
    // 404 is deliberately ambiguous.
  }

  return {
    fileId: file._id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    humanReadableSize: file.humanReadableSize,
    isPasswordProtected: file.isPasswordProtected,
    // Show remaining downloads if there's a limit — UX decision
    downloadsRemaining:
      file.maxDownloads !== null ? file.downloadsRemaining : null,
    maxDownloads: file.maxDownloads,
    expiresAt: file.expiresAt,
    createdAt: file.createdAt,
  };
}

/**
 * downloadFile
 *
 * The most security-critical service method in VaultShare.
 *
 * Sequence (ORDER IS LOAD-BEARING — do not reorder):
 *   1. Fetch file with status check
 *   2. canBeDownloaded() gate
 *   3. Password verification (timing-safe)
 *   4. Atomic decrement (the point of no return)
 *   5. Audit logging
 *   6. Signed URL generation
 *
 * @param {Object} params
 * @param {string}      params.fileId       - MongoDB ObjectId string
 * @param {string|null} params.password     - Plain text password from client
 * @param {string}      params.ipAddress    - Raw IP for hashing
 * @param {string}      params.userAgent    - User-Agent header
 * @returns {Promise<Object>} { signedUrl, originalName, mimeType, downloadsRemaining }
 */
async function downloadFile({
  fileId,
  password,
  ipAddress,
  userAgent,
  acceptLanguage,
}) {
  // ── Step 1: Check lockout (cheapest — no DB) ──────────────────────────
  const lockStatus = await attemptTracker.isLocked(
    fileId,
    ipAddress,
    userAgent,
    acceptLanguage,
  );

  if (lockStatus.locked) {
    const remainingMinutes = Math.ceil(lockStatus.remainingMs / 60000);
    const message =
      lockStatus.reason === "GLOBAL_LOCKOUT"
        ? `This file has been locked due to too many failed attempts. Try again in ${remainingMinutes} minute(s).`
        : `Too many failed attempts from your location. Try again in ${remainingMinutes} minute(s).`;
    throw AppError.tooManyRequests(message);
  }

  // ── Step 2: Fetch file ────────────────────────────────────────────────
  const file = await File.findByIdActive(fileId);
  if (!file) {
    throw AppError.notFound(
      "File not found. It may have expired or been deleted.",
    );
  }

  // ── Step 3: Access gate ───────────────────────────────────────────────
  const { allowed, reason } = file.canBeDownloaded();
  if (!allowed) {
    const message =
      reason === "DOWNLOAD_LIMIT_REACHED"
        ? "This file has reached its download limit."
        : "File not found. It may have expired or been deleted.";
    throw AppError.notFound(message);
  }

  // ── Step 4: Password verification with attempt tracking ───────────────
  try {
    await verifyPassword(file, password);
  } catch (err) {
    if (file.isPasswordProtected) {
      const result = await attemptTracker.recordFailure(
        fileId,
        ipAddress,
        userAgent,
        acceptLanguage,
      );

      if (result.globalLocked) {
        throw AppError.tooManyRequests(
          "Too many failed attempts on this file. Access locked for 15 minutes.",
        );
      }

      if (result.locked) {
        throw AppError.tooManyRequests(
          "Too many failed attempts. Access locked for 15 minutes.",
        );
      }

      const remaining = Math.min(
        result.attemptsRemainingIp,
        result.attemptsRemainingGlobal,
      );

      throw AppError.unauthorized(
        `Incorrect password. ${remaining} attempt(s) remaining.`,
      );
    }
    throw err;
  }

  // ── Step 5: Reset per-client counter on success ───────────────────────
  if (file.isPasswordProtected) {
    await attemptTracker.resetClientAttempts(
      fileId,
      ipAddress,
      userAgent,
      acceptLanguage,
    );
  }

  // ── Step 6: Atomic decrement ──────────────────────────────────────────
  const updatedFile = await atomicDecrementDownload(fileId);
  if (!updatedFile) {
    throw AppError.notFound("This file has reached its download limit.");
  }

  // ── Step 7: Audit logging (fire and forget) ───────────────────────────
  logDownload(updatedFile, ipAddress, userAgent).catch((err) => {
    console.error("[FileService] Audit log failed:", err.message);
  });

  // ── Step 8: Generate signed URL ───────────────────────────────────────
  const signedUrl = await generateDeliveryUrl(updatedFile);

  return {
    signedUrl,
    originalName: updatedFile.originalName,
    mimeType: updatedFile.mimeType,
    downloadsRemaining:
      updatedFile.maxDownloads !== null ? updatedFile.downloadsRemaining : null,
    urlExpiresInSeconds: env.signedUrlTtlSeconds,
  };
}

// ─── Lifecycle management ──────────────────────────────────────────────────

/**
 * deleteFile (soft delete)
 *
 * Marks a file as deleted and triggers storage cleanup.
 * Does NOT require authentication in this version — any client with
 * the fileId can delete. Day 9 adds an upload token for ownership verification.
 *
 * Sequence (same ordering principle as expiry job):
 *   1. Mark as 'deleted' in MongoDB first
 *   2. Delete from Cloudinary
 *   3. Clear storageKey
 *
/**
 * softDeleteFile — now requires upload token verification.
 *
 * @param {string} fileId
 * @param {string} uploadToken - Plaintext token from Authorization header
 */
async function softDeleteFile(fileId, uploadToken) {
  const file = await File.findById(fileId);

  if (!file) {
    throw AppError.notFound("File not found.");
  }

  if (file.status === "deleted") {
    return; // Idempotent
  }

  // ── Verify upload token ───────────────────────────────────────────────
  // Files created before Day 7 have no uploadTokenHash — allow deletion
  // without token for backward compatibility (remove this in production).
  if (file.uploadTokenHash) {
    const isValid = await verifyUploadToken(uploadToken, file.uploadTokenHash);
    if (!isValid) {
      throw AppError.unauthorized(
        "Invalid upload token. Only the original uploader can delete this file.",
      );
    }
  }

  // ── Mark deleted ──────────────────────────────────────────────────────
  await File.updateOne({ _id: fileId }, { $set: { status: "deleted" } });

  // ── Delete from storage ───────────────────────────────────────────────
  if (file.storageKey) {
    try {
      let provider;
      if (file.storageProvider === "cloudinary") {
        const CloudinaryProvider = require("../storage/CloudinaryProvider");
        provider = new CloudinaryProvider();
      } else {
        const S3Provider = require("../storage/S3Provider");
        provider = new S3Provider();
      }

      await provider.deleteFile(file.storageKey);
      await File.updateOne({ _id: fileId }, { $set: { storageKey: null } });
    } catch (err) {
      console.error(
        `[FileService] Storage deletion failed for ${fileId}:`,
        err.message,
      );
    }
  }
}

/**
 * getFileStatus
 *
 * Returns the full lifecycle status of a file.
 * Used by uploaders to monitor their file's state.
 *
 * Unlike getFileMeta (which returns 404 for expired files),
 * this returns the actual status — useful for the uploader's dashboard.
 *
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
async function getFileStatus(fileId) {
  const file = await File.findById(fileId);

  if (!file) {
    throw AppError.notFound("File not found.");
  }

  return {
    fileId: file._id,
    originalName: file.originalName,
    status: file.status,
    isPasswordProtected: file.isPasswordProtected,
    maxDownloads: file.maxDownloads,
    downloadsRemaining: file.downloadsRemaining,
    downloadCount: file.downloadCount,
    humanReadableSize: file.humanReadableSize,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    expiresAt: file.expiresAt,
    isExpired: file.isExpired, // real-time virtual
    isDownloadLimitReached: file.isDownloadLimitReached,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

// Add to module.exports:
module.exports = {
  generateUploadCredentials,
  registerFile,
  getFileMeta,
  downloadFile,
  softDeleteFile, // ← new
  getFileStatus, // ← new
};

// ─── Private helpers ───────────────────────────────────────────────────────

/**
 * verifyPassword
 *
 * Timing-safe password verification.
 *
 * Always runs bcrypt.compare() regardless of whether the file is password
 * protected. This ensures identical response times for:
 *   - Correct password
 *   - Wrong password
 *   - No password required (dummy comparison)
 *   - No password provided but required
 *
 * This eliminates timing side-channels that would reveal file state.
 *
 * @param {import('../models/File.model')} file
 * @param {string|null|undefined} providedPassword
 */
async function verifyPassword(file, providedPassword) {
  // Use the real hash if it exists, dummy hash otherwise.
  // bcrypt.compare() takes ~250ms either way.
  const hashToCompare = file.passwordHash || DUMMY_HASH;

  // Always compare something — never short-circuit before bcrypt runs
  const candidatePassword = providedPassword || "";
  const isMatch = await bcrypt.compare(candidatePassword, hashToCompare);

  // Three states that all result in rejection:
  //   1. File requires password, wrong password provided
  //   2. File requires password, no password provided
  //   3. (File has no password — isMatch will be false with dummy hash,
  //      but isPasswordProtected is also false, so we don't throw)
  if (file.isPasswordProtected && !isMatch) {
    throw AppError.unauthorized("Incorrect password.");
  }

  // If file is not password protected, we don't care about isMatch.
  // The dummy comparison already ran — timing is preserved.
}

/**
 * atomicDecrementDownload
 *
 * Single MongoDB operation that:
 *   1. Finds the file by ID with status 'active'
 *   2. Verifies downloadsRemaining > 0 OR is null (unlimited)
 *   3. Decrements downloadsRemaining by 1 (skipped if null — unlimited)
 *
 * Returns the updated document (new: true) or null if the filter didn't match.
 * A null result means either the file doesn't exist OR the limit was just hit.
 *
 * CRITICAL: This uses findOneAndUpdate, not findById + save().
 * The filter and update are atomic — no other operation can interleave.
 *
 * @param {string} fileId
 * @returns {Promise<import('../models/File.model')|null>}
 */
async function atomicDecrementDownload(fileId) {
  // Limited file path
  const limitedResult = await File.findOneAndUpdate(
    {
      _id: fileId,
      status: "active",
      maxDownloads: { $ne: null },
      downloadsRemaining: { $gt: 0 },
    },
    { $inc: { downloadsRemaining: -1 } },
    {
      returnDocument: "after", // ← replaces deprecated { new: true }
      runValidators: false,
    },
  );

  if (limitedResult) return limitedResult;

  // Unlimited file path
  const unlimitedResult = await File.findOneAndUpdate(
    {
      _id: fileId,
      status: "active",
      maxDownloads: null,
    },
    { $set: { updatedAt: new Date() } },
    {
      returnDocument: "after", // ← replaces deprecated { new: true }
      runValidators: false,
    },
  );

  return unlimitedResult;
}

/**
 * logDownload
 *
 * Appends a download audit entry and increments downloadCount.
 * Called after a successful decrement — never before.
 *
 * We use updateOne here rather than fetching the document and calling
 * file.recordDownload() + file.save(). This is intentional:
 *   - We already have the updated document from atomicDecrementDownload
 *   - A second find-then-save would require fetching the full downloads array
 *   - $push + $inc in a single updateOne is more efficient
 *
 * @param {Object} file    - Updated file document from atomicDecrementDownload
 * @param {string} ipAddress
 * @param {string} userAgent
 */
async function logDownload(file, ipAddress, userAgent) {
  const ipHash = hashIp(ipAddress);

  await File.updateOne(
    { _id: file._id },
    {
      $push: {
        downloads: {
          downloadedAt: new Date(),
          ipHash,
          userAgent: (userAgent || "").substring(0, 200),
        },
      },
      $inc: { downloadCount: 1 },
    },
  );
}

/**
 * generateDeliveryUrl
 *
 * Routes to the correct storage provider based on the file's storageProvider
 * field. This is how the Cloudinary → S3 migration works transparently —
 * old files serve from Cloudinary, new files from S3, same code path.
 *
 * @param {Object} file - Updated file document
 * @returns {Promise<string>} Signed URL
 */
async function generateDeliveryUrl(file) {
  // During migration: each file knows which provider stored it.
  // We import both providers and select based on the document's field.
  // In steady state (all files on one provider), this always picks the same one.
  let provider;

  if (file.storageProvider === "cloudinary") {
    const CloudinaryProvider = require("../storage/CloudinaryProvider");
    provider = new CloudinaryProvider();
  } else if (file.storageProvider === "s3") {
    const S3Provider = require("../storage/S3Provider");
    provider = new S3Provider();
  } else {
    throw AppError.serviceUnavailable(
      `Unknown storage provider: ${file.storageProvider}`,
    );
  }

  return provider.generateSignedDeliveryUrl(file.storageKey, {
    ttlSeconds: env.signedUrlTtlSeconds,
    originalName: file.originalName,
    mimeType: file.mimeType,
  });
}

// ─── Exports ───────────────────────────────────────────────────────────────
// Add getFileMeta and downloadFile to the existing module.exports

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
  // Skip verification in development — the Cloudinary Admin API
  // may be blocked by network/firewall. In production, enable this.
  if (env.nodeEnv === "development") {
    console.log(
      `[FileService] Skipping Cloudinary verification in dev for: ${storageKey}`,
    );
    return;
  }

  const CloudinaryProvider = require("../storage/CloudinaryProvider");
  const provider = new CloudinaryProvider();

  try {
    const resource = await provider.verifyResource(storageKey);
    if (!resource) {
      throw AppError.badRequest(
        "The uploaded file could not be verified. Please try uploading again.",
        "STORAGE_KEY_NOT_FOUND",
      );
    }
  } catch (err) {
    if (err.isOperational) throw err;
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
  getFileMeta,
  downloadFile,
  softDeleteFile,
  getFileStatus,
};
