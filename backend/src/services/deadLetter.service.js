/**
 * Dead-letter service — manages the failed deletion retry queue.
 *
 * Used by:
 *   - expiry.job.js (create on failed Cloudinary delete)
 *   - file.service.js (create on failed soft-delete)
 *   - admin.service.js (create on failed admin delete)
 *   - The cron job's retry pass (process pending jobs)
 */

"use strict";

const DeadLetter = require("../models/DeadLetter.model");

/**
 * Enqueue a failed deletion for retry.
 * Idempotent — if a job already exists for this storageKey + pending status,
 * don't create a duplicate.
 *
 * @param {Object} params
 * @param {string} params.storageKey
 * @param {string} params.storageProvider
 * @param {string} params.reason
 * @param {string} [params.fileId]
 * @param {string} [params.error]
 * @returns {Promise<DeadLetter>}
 */
async function enqueue({ storageKey, storageProvider, reason, fileId, error }) {
  // Idempotency: don't create duplicate jobs for the same key
  const existing = await DeadLetter.findOne({
    storageKey,
    status: { $in: ["pending", "retrying"] },
  });

  if (existing) {
    console.log(
      `[DeadLetter] Job already exists for ${storageKey} — skipping duplicate`,
    );
    return existing;
  }

  const job = await DeadLetter.create({
    storageKey,
    storageProvider,
    reason,
    fileId: fileId || null,
    lastError: error || null,
    status: "pending",
    nextRetryAt: new Date(), // attempt immediately
  });

  console.log(
    `[DeadLetter] Enqueued ${storageKey} (reason: ${reason}, jobId: ${job._id})`,
  );

  return job;
}

/**
 * Process all pending dead-letter jobs that are ready to retry.
 * Called by the cron job on every sweep.
 *
 * @returns {Promise<{ processed: number, resolved: number, failed: number }>}
 */
async function processQueue() {
  const jobs = await DeadLetter.find({
    status: "pending",
    nextRetryAt: { $lte: new Date() },
  }).lean();

  if (jobs.length === 0) return { processed: 0, resolved: 0, failed: 0 };

  console.log(`[DeadLetter] Processing ${jobs.length} pending job(s)`);

  let resolved = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await processJob(job);
    if (result.resolved) resolved++;
    else failed++;
  }

  return { processed: jobs.length, resolved, failed };
}

/**
 * Process a single dead-letter job.
 * Updates the job document based on success or failure.
 *
 * @param {Object} job - DeadLetter document (lean)
 * @returns {Promise<{ resolved: boolean }>}
 */
async function processJob(job) {
  // Mark as retrying (prevents concurrent processing)
  await DeadLetter.updateOne(
    { _id: job._id, status: "pending" }, // optimistic lock
    {
      $set: {
        status: "retrying",
        lastAttemptAt: new Date(),
        attempts: job.attempts + 1,
      },
    },
  );

  try {
    // Attempt the deletion
    await deleteFromStorage(job.storageKey, job.storageProvider);

    // Success — mark resolved and clear the File's storageKey if it has one
    await DeadLetter.updateOne(
      { _id: job._id },
      { $set: { status: "resolved", lastError: null } },
    );

    // Clear storageKey on the File document if referenced
    if (job.fileId) {
      const File = require("../models/File.model");
      await File.updateOne({ _id: job.fileId }, { $set: { storageKey: null } });
    }

    console.log(
      `[DeadLetter] Resolved ${job.storageKey} on attempt ${job.attempts + 1}`,
    );

    return { resolved: true };
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const maxExceeded = newAttempts >= job.maxAttempts;

    if (maxExceeded) {
      // Give up — requires manual intervention
      await DeadLetter.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "failed",
            lastError: err.message,
            attempts: newAttempts,
          },
        },
      );

      console.error(
        `[DeadLetter] PERMANENTLY FAILED ${job.storageKey} after ${newAttempts} attempts. ` +
          `Manual cleanup required. JobId: ${job._id}`,
      );
    } else {
      // Schedule next retry with exponential backoff
      const nextRetry = DeadLetter.nextRetryTime(newAttempts);

      await DeadLetter.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "pending",
            lastError: err.message,
            attempts: newAttempts,
            nextRetryAt: nextRetry,
          },
        },
      );

      console.warn(
        `[DeadLetter] Retry ${newAttempts}/${job.maxAttempts} failed for ${job.storageKey}. ` +
          `Next attempt at ${nextRetry.toISOString()}`,
      );
    }

    return { resolved: false };
  }
}

/**
 * Delete a file from the appropriate storage provider.
 * Used internally by the dead-letter processor.
 */
async function deleteFromStorage(storageKey, storageProvider) {
  if (storageProvider === "cloudinary") {
    const CloudinaryProvider = require("../storage/CloudinaryProvider");
    const provider = new CloudinaryProvider();
    await provider.deleteFile(storageKey);
  } else if (storageProvider === "s3") {
    const S3Provider = require("../storage/S3Provider");
    const provider = new S3Provider();
    await provider.deleteFile(storageKey);
  } else {
    throw new Error(`Unknown storage provider: ${storageProvider}`);
  }
}

/**
 * Get dead-letter queue stats for the admin dashboard.
 */
async function getQueueStats() {
  const stats = await DeadLetter.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const byStatus = { pending: 0, retrying: 0, resolved: 0, failed: 0 };
  for (const row of stats) {
    byStatus[row._id] = row.count;
  }

  const permanentlyFailed = await DeadLetter.find(
    { status: "failed" },
    {
      storageKey: 1,
      storageProvider: 1,
      attempts: 1,
      lastError: 1,
      updatedAt: 1,
    },
  ).lean();

  return { byStatus, permanentlyFailed };
}

module.exports = {
  enqueue,
  processQueue,
  getQueueStats,
};
