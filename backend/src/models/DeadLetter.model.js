/**
 * DeadLetter model — stores failed storage deletion jobs.
 *
 * When the cron job or soft-delete fails to remove a file from
 * Cloudinary/S3, instead of silently dropping the failure, we
 * create a DeadLetter document. The cron job processes these
 * with exponential backoff.
 *
 * Lifecycle:
 *   pending  → job created, waiting for nextRetryAt
 *   retrying → currently being processed
 *   resolved → successfully deleted from storage
 *   failed   → exceeded maxAttempts, needs manual intervention
 */

"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const deadLetterSchema = new Schema(
  {
    // What needs to be deleted
    storageKey: {
      type: String,
      required: true,
    },
    storageProvider: {
      type: String,
      enum: ["cloudinary", "s3"],
      required: true,
    },

    // Why it's here
    reason: {
      type: String,
      required: true,
      // 'expiry_cleanup'   — cron job failed to delete expired file
      // 'soft_delete'      — user-initiated delete failed
      // 'admin_delete'     — admin force delete failed
      // 'orphan_cleanup'   — orphan detection failed to delete
    },

    // Reference to the File document (may be null for orphans with no DB record)
    fileId: {
      type: Schema.Types.ObjectId,
      ref: "File",
      default: null,
    },

    // Retry tracking
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 10,
    },
    nextRetryAt: {
      type: Date,
      default: () => new Date(), // retry immediately on first attempt
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "retrying", "resolved", "failed"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

// Index for the cron job's query: find pending jobs ready to retry
deadLetterSchema.index({ status: 1, nextRetryAt: 1 });

// Index for looking up by storageKey (idempotency check)
deadLetterSchema.index({ storageKey: 1, status: 1 });

/**
 * Calculate next retry time with exponential backoff.
 * Caps at 60 minutes.
 *
 * @param {number} attemptNumber - 1-indexed attempt count
 * @returns {Date}
 */
deadLetterSchema.statics.nextRetryTime = function (attemptNumber) {
  const BASE_DELAY_MS = 60 * 1000; // 1 minute base
  const MAX_DELAY_MS = 60 * 60 * 1000; // 60 minute cap
  const delay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attemptNumber - 1),
    MAX_DELAY_MS,
  );
  return new Date(Date.now() + delay);
};

const DeadLetter = mongoose.model("DeadLetter", deadLetterSchema);
module.exports = DeadLetter;
