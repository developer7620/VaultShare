/**
 * Expiry job — runs on a schedule to clean up expired files.
 *
 * Responsibilities:
 *   1. Find all files where expiresAt <= now AND status === 'active'
 *   2. Mark each as status: 'expired' in MongoDB (source of truth first)
 *   3. Delete each from its storage provider (Cloudinary or S3)
 *   4. Clear the storageKey (signal that Cloudinary cleanup succeeded)
 *
 * Failure handling:
 *   - MongoDB update fails → file stays 'active', cron retries next run. Safe.
 *   - Cloudinary delete fails → file is 'expired' in DB (no downloads possible)
 *     but storageKey is still set. Next cron run detects expired files with
 *     storageKey still set and retries the deletion. Eventually consistent.
 *
 * This job also handles files that hit their download limit — those are
 * marked expired by the download service, but Cloudinary cleanup still
 * needs to happen here.
 */

"use strict";

const cron = require("node-cron");
const File = require("../models/File.model");
const CloudinaryProvider = require("../storage/CloudinaryProvider");
const S3Provider = require("../storage/S3Provider");
const env = require("../config/env");

// ─── Provider cache ────────────────────────────────────────────────────────
// Reuse provider instances across cron runs — no need to re-instantiate
// the SDK client on every execution.
const providers = {
  cloudinary: new CloudinaryProvider(),
  s3: null, // instantiated lazily when first needed
};

function getProvider(providerName) {
  if (providerName === "cloudinary") {
    return providers.cloudinary;
  }

  if (providerName === "s3") {
    if (!providers.s3) {
      providers.s3 = new S3Provider();
    }
    return providers.s3;
  }

  throw new Error(`[ExpiryJob] Unknown storage provider: ${providerName}`);
}

// ─── Core job logic ────────────────────────────────────────────────────────

/**
 * sweepExpiredFiles
 *
 * The main job function. Called on each cron tick.
 * Also exported so it can be called manually (e.g., on startup, in tests).
 *
 * Two passes:
 *   Pass 1 — time-expired active files (expiresAt <= now, status: active)
 *   Pass 2 — storage-cleanup pass for already-expired files whose Cloudinary
 *             deletion failed previously (status: expired, storageKey not null)
 */
async function sweepExpiredFiles() {
  const runId = Date.now();
  const deadLetterService = require("../services/deadLetter.service");

  console.log(`[ExpiryJob:${runId}] Starting sweep`);

  try {
    const nowExpired = await findAndMarkExpired(runId);
    const retryTargets = await findExpiredWithStorageKey(runId);
    const toDelete = [...nowExpired, ...retryTargets];

    if (toDelete.length > 0) {
      console.log(
        `[ExpiryJob:${runId}] Deleting ${toDelete.length} file(s) from storage`,
      );
      await deleteInBatches(toDelete, 5, runId);
    } else {
      console.log(`[ExpiryJob:${runId}] No files to clean up`);
    }

    // Process dead-letter queue on every sweep
    const dlResult = await deadLetterService.processQueue();
    if (dlResult.processed > 0) {
      console.log(
        `[ExpiryJob:${runId}] Dead-letter: ` +
          `${dlResult.resolved} resolved, ${dlResult.failed} still failing`,
      );
    }

    console.log(`[ExpiryJob:${runId}] Sweep complete`);
  } catch (err) {
    console.error(`[ExpiryJob:${runId}] Sweep failed:`, err.message);
  }
}

/**
 * findAndMarkExpired
 *
 * Atomically finds active files past their expiresAt and marks them expired.
 * Uses updateMany for efficiency — one DB round trip for all expired files.
 *
 * Returns the list of files that were marked (need storage deletion).
 */
async function findAndMarkExpired(runId) {
  // First, get the IDs of files we're about to expire
  // (updateMany doesn't return the affected documents)
  const expiredFiles = await File.find(
    {
      status: "active",
      expiresAt: { $lte: new Date() },
    },
    // Only fetch fields needed for storage deletion
    { _id: 1, storageKey: 1, storageProvider: 1 },
  ).lean();

  if (expiredFiles.length === 0) return [];

  // Mark all as expired in one operation
  const ids = expiredFiles.map((f) => f._id);
  await File.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        status: "expired",
        // Record when the expiry was processed (not when it was due)
        updatedAt: new Date(),
      },
    },
  );

  console.log(
    `[ExpiryJob:${runId}] Marked ${expiredFiles.length} file(s) as expired`,
  );

  return expiredFiles;
}

/**
 * findExpiredWithStorageKey
 *
 * Finds files already marked 'expired' but still having a storageKey —
 * meaning a previous Cloudinary deletion attempt failed.
 * These need their deletion retried.
 */
async function findExpiredWithStorageKey(runId) {
  const retryFiles = await File.find(
    {
      status: "expired",
      storageKey: { $ne: null }, // deletion not yet confirmed
    },
    { _id: 1, storageKey: 1, storageProvider: 1 },
  ).lean();

  if (retryFiles.length > 0) {
    console.log(
      `[ExpiryJob:${runId}] Found ${retryFiles.length} file(s) pending storage deletion (retry)`,
    );
  }

  return retryFiles;
}

/**
 * deleteInBatches
 *
 * Processes file deletions in parallel batches to avoid overwhelming
 * the storage provider's API rate limits.
 *
 * @param {Array}  files       - Array of { _id, storageKey, storageProvider }
 * @param {number} batchSize   - How many concurrent deletions per batch
 * @param {string} runId       - For log correlation
 */
async function deleteInBatches(files, batchSize, runId) {
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    // Process this batch concurrently
    await Promise.allSettled(
      batch.map((file) => deleteFileFromStorage(file, runId)),
    );
  }
}

/**
 * deleteFileFromStorage
 *
 * Deletes a single file from its storage provider, then clears the
 * storageKey in MongoDB to signal successful cleanup.
 *
 * If deletion fails, the storageKey remains set — the next cron run
 * will find this file via findExpiredWithStorageKey and retry.
 *
 * @param {{ _id, storageKey, storageProvider }} file
 * @param {string} runId
 */
async function deleteFileFromStorage(file, runId) {
  const deadLetterService = require("../services/deadLetter.service");

  try {
    const provider = getProvider(file.storageProvider);
    await provider.deleteFile(file.storageKey);

    // Clear storageKey — signals that storage deletion succeeded
    await File.updateOne({ _id: file._id }, { $set: { storageKey: null } });

    console.log(
      `[ExpiryJob:${runId}] Deleted ${file.storageKey} from ${file.storageProvider}`,
    );
  } catch (err) {
    console.error(
      `[ExpiryJob:${runId}] Failed to delete ${file.storageKey}:`,
      err.message,
    );

    // Enqueue for retry instead of silently dropping
    await deadLetterService
      .enqueue({
        storageKey: file.storageKey,
        storageProvider: file.storageProvider,
        reason: "expiry_cleanup",
        fileId: file._id,
        error: err.message,
      })
      .catch((enqueueErr) => {
        // If even the enqueue fails, log it — don't crash the cron job
        console.error(
          `[ExpiryJob:${runId}] Failed to enqueue dead-letter for ${file.storageKey}:`,
          enqueueErr.message,
        );
      });
  }
}

// ─── Job lifecycle ─────────────────────────────────────────────────────────

/**
 * startExpiryJob
 *
 * Creates and starts the cron job. Returns the job instance so the
 * caller (server.js) can stop it during graceful shutdown.
 *
 * Schedule: every 5 minutes
 * cron expression: minute field 'star slash 5', then '* * * *'
 *               = at minute 0, 5, 10, 15... of every hour
 *
 * @param {Object} options
 * @param {boolean} options.runImmediately - Run one sweep on startup
 * @returns {cron.ScheduledTask}
 */
function startExpiryJob({ runImmediately = false } = {}) {
  const schedule =
    env.nodeEnv === "test"
      ? null // Don't run cron in test environment
      : "*/5 * * * *";

  if (!schedule) {
    console.log("[ExpiryJob] Skipped — test environment");
    return { stop: () => {} }; // Return no-op for tests
  }

  // Run one sweep immediately on server startup.
  // Catches files that expired during a server downtime window.
  if (runImmediately) {
    console.log("[ExpiryJob] Running initial sweep on startup");
    sweepExpiredFiles(); // intentionally not awaited — don't block startup
  }

  const job = cron.schedule(schedule, sweepExpiredFiles, {
    scheduled: true,
    timezone: "UTC", // Always use UTC — never local timezone in servers
  });

  console.log(`[ExpiryJob] Scheduled — runs every 5 minutes (UTC)`);

  return job;
}

module.exports = { startExpiryJob, sweepExpiredFiles };
