/**
 * File model — the central document in VaultShare.
 *
 * Design decisions documented inline. Read these before modifying the schema —
 * several field names and types are load-bearing for the atomic download logic.
 */

"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

// ─── Sub-schema: individual download audit entry ───────────────────────────
// Stored as an array on the File document rather than a separate collection.
// Trade-off: simpler queries, but document grows with each download.
// If maxDownloads is large (e.g. 10,000), use a separate DownloadLog collection.
// For VaultShare's expected limits (max ~100 downloads), embedded is correct.
const downloadAuditSchema = new Schema(
  {
    downloadedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    // Store a hashed IP, never the raw IP — privacy by design.
    // SHA-256(ip) is deterministic (useful for abuse detection) but
    // not reversible to the original IP without the plaintext.
    ipHash: {
      type: String,
      required: true,
    },
    // User-agent truncated to 200 chars — useful for abuse patterns,
    // not useful beyond that length.
    userAgent: {
      type: String,
      maxlength: 200,
    },
  },
  { _id: false }, // No separate _id per audit entry — saves space
);

// ─── Main File schema ──────────────────────────────────────────────────────
const fileSchema = new Schema(
  {
    // ── Storage ─────────────────────────────────────────────────────────────
    // The key that identifies this file in the storage provider.
    // For Cloudinary: the public_id (e.g. "vaultshare/abc123")
    // For S3: the object key (e.g. "uploads/abc123/report.pdf")
    // Named generically so the model doesn't need to change when switching providers.
    storageKey: {
      type: String,
      required: [true, "Storage key is required"],
      trim: true,
    },

    // Which provider stored this file — critical for the S3 migration.
    // When we switch to S3, existing files still have provider: 'cloudinary'
    // and will be fetched/deleted via Cloudinary. New files use 'S3'.
    // This is how you do a live migration without downtime.
    storageProvider: {
      type: String,
      enum: ["cloudinary", "s3"],
      required: true,
    },

    originalName: {
      type: String,
      required: [true, "Original filename is required"],
      trim: true,
      maxlength: [255, "Filename cannot exceed 255 characters"],
    },

    mimeType: {
      type: String,
      required: [true, "MIME type is required"],
      // Basic validation — Cloudinary validates the actual content
      match: [/^[a-z]+\/[a-z0-9\-+.]+$/i, "Invalid MIME type format"],
    },

    sizeBytes: {
      type: Number,
      required: [true, "File size is required"],
      min: [1, "File size must be at least 1 byte"],
      // 100MB limit — adjust per your Cloudinary plan
      max: [104_857_600, "File size cannot exceed 100MB"],
    },

    // ── Security ────────────────────────────────────────────────────────────
    // bcrypt hash — never the plaintext password.
    // null means no password protection.
    passwordHash: {
      type: String,
      default: null,
    },

    isPasswordProtected: {
      type: Boolean,
      default: false,
      // Index: download endpoint filters on this to decide whether to prompt
      index: true,
    },

    // ── Download limits ──────────────────────────────────────────────────────
    // null = unlimited downloads
    maxDownloads: {
      type: Number,
      default: null,
      min: [1, "Max downloads must be at least 1"],
      max: [10_000, "Max downloads cannot exceed 10,000"],
    },

    // CRITICAL: this field is the one decremented atomically in the download
    // endpoint. It must exactly mirror maxDownloads on creation, then count down.
    // Never update this outside of the atomic findOneAndUpdate call.
    downloadsRemaining: {
      type: Number,
      default: null,
      min: [0, "Downloads remaining cannot be negative"],
    },

    // Monotonically increasing — never decremented.
    // Used for analytics and admin views. Separate from downloadsRemaining
    // so that if we ever grant "bonus downloads", the audit trail is clean.
    downloadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ── Expiry ───────────────────────────────────────────────────────────────
    // null = never expires
    expiresAt: {
      type: Date,
      default: null,
      // Compound index with status — the cron job queries this constantly
      index: true,
    },

    // ── Lifecycle ────────────────────────────────────────────────────────────
    // 'active'  — file is accessible
    // 'expired' — time or download limit reached; file deleted from storage
    // 'deleted' — manually deleted by uploader
    status: {
      type: String,
      enum: {
        values: ["active", "expired", "deleted"],
        message: "Status must be active, expired, or deleted",
      },
      default: "active",
      index: true,
    },

    // ── Audit ────────────────────────────────────────────────────────────────
    downloads: {
      type: [downloadAuditSchema],
      default: [],
      // Don't return this array in list queries — only in detail view
      // Controlled via projection in service layer, not here
    },
  },
  {
    // Automatically adds createdAt and updatedAt
    timestamps: true,

    // toJSON transform: strip sensitive fields from any res.json(file) call
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        // Never expose the password hash to API consumers
        delete ret.passwordHash;
        // Remove the raw downloads audit array from public responses
        // (available via a separate admin endpoint if needed)
        delete ret.downloads;
        // Remove mongoose internals
        delete ret.__v;
        return ret;
      },
    },

    toObject: {
      virtuals: true,
    },
  },
);

// ─── Compound indexes ──────────────────────────────────────────────────────
// Cron job: find active files where expiresAt has passed
fileSchema.index({ status: 1, expiresAt: 1 });

// Admin: list files ordered by creation date
fileSchema.index({ status: 1, createdAt: -1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────
// Computed fields that are not stored in MongoDB

/**
 * isExpired — true if the expiry date has passed.
 * Note: this is a real-time check. The `status` field is updated
 * by the cron job asynchronously, so there's a window where
 * expiresAt has passed but status is still 'active'.
 * Always use this virtual for expiry checks in the download flow —
 * never rely solely on status === 'active'.
 */
fileSchema.virtual("isExpired").get(function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

/**
 * isDownloadLimitReached — true if no downloads remain.
 * null maxDownloads means unlimited, so always false.
 */
fileSchema.virtual("isDownloadLimitReached").get(function () {
  if (this.maxDownloads === null) return false;
  return this.downloadsRemaining <= 0;
});

/**
 * humanReadableSize — e.g. "2.4 MB"
 */
fileSchema.virtual("humanReadableSize").get(function () {
  const bytes = this.sizeBytes;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
});

// ─── Instance methods ──────────────────────────────────────────────────────

/**
 * canBeDownloaded() — single source of truth for download eligibility.
 *
 * Centralising this logic on the model means controllers never have
 * scattered `if (file.status !== 'active' || file.isExpired || ...)` checks.
 * There is exactly one place to update if business rules change.
 *
 * @returns {{ allowed: boolean, reason: string | null }}
 */
fileSchema.methods.canBeDownloaded = function () {
  if (this.status !== "active") {
    return { allowed: false, reason: "FILE_INACTIVE" };
  }

  if (this.isExpired) {
    return { allowed: false, reason: "FILE_EXPIRED" };
  }

  if (this.isDownloadLimitReached) {
    return { allowed: false, reason: "DOWNLOAD_LIMIT_REACHED" };
  }

  return { allowed: true, reason: null };
};

/**
 * recordDownload() — appends an audit entry.
 *
 * Called AFTER the atomic decrement succeeds. Does not save() — the caller
 * decides when to persist (allows batching with other updates).
 *
 * @param {string} ipHash   - SHA-256 hash of the requester's IP
 * @param {string} userAgent - Truncated user-agent string
 */
fileSchema.methods.recordDownload = function (ipHash, userAgent = "") {
  this.downloads.push({
    downloadedAt: new Date(),
    ipHash,
    userAgent: userAgent.substring(0, 200),
  });
  this.downloadCount += 1;
};

// ─── Static methods ────────────────────────────────────────────────────────

/**
 * findExpiredActive() — used by cron job to find files needing cleanup.
 *
 * Returns only the fields the cron job needs — avoids loading the
 * full downloads array for potentially thousands of documents.
 */
fileSchema.statics.findExpiredActive = function () {
  return this.find(
    {
      status: "active",
      expiresAt: { $lte: new Date() },
    },
    // Projection: only fields needed for cleanup
    { _id: 1, storageKey: 1, storageProvider: 1, expiresAt: 1 },
  ).lean(); // .lean() returns plain JS objects, faster than full Mongoose docs
};

/**
 * findByIdActive() — fetch a file only if it's in active status.
 * Returns null for expired/deleted files, same as not found.
 * This prevents timing attacks: don't reveal whether an ID existed.
 */
fileSchema.statics.findByIdActive = function (id) {
  return this.findOne({ _id: id, status: "active" });
};

const File = mongoose.model("File", fileSchema);

module.exports = File;
