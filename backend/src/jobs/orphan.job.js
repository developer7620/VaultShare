/**
 * Orphan detection job.
 *
 * Detects Type A orphans: files in Cloudinary with no MongoDB record.
 *
 * How it works:
 *   1. List all files in Cloudinary's vaultshare/ folder
 *   2. For each public_id, check if a File document exists in MongoDB
 *   3. If no document found AND the file is older than GRACE_PERIOD_MS,
 *      delete it from Cloudinary
 *
 * Grace period: files uploaded in the last 2 hours are NOT deleted.
 * This handles the race condition where a file is uploaded but
 * /register hasn't been called yet.
 *
 * Run frequency: once per hour (not every 5 minutes like expiry sweep).
 * Cloudinary's Admin API has rate limits — don't hammer it.
 *
 * Production note: Cloudinary's resources.list() is paginated.
 * This implementation handles pagination correctly.
 */

"use strict";

const cron = require("node-cron");
const { v2: cloudinary } = require("cloudinary");
const File = require("../models/File.model");
const deadLetterService = require("../services/deadLetter.service");
const env = require("../config/env");

// Files newer than this are not considered orphans
const GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Main orphan detection sweep.
 * Lists Cloudinary folder contents and cross-references with MongoDB.
 */
async function detectOrphans() {
  const runId = Date.now();
  console.log(`[OrphanJob:${runId}] Starting orphan detection`);

  // Configure cloudinary client
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });

  try {
    const cloudinaryKeys = await listCloudinaryFiles(runId);

    if (cloudinaryKeys.length === 0) {
      console.log(`[OrphanJob:${runId}] No files in Cloudinary folder`);
      return;
    }

    console.log(
      `[OrphanJob:${runId}] Found ${cloudinaryKeys.length} file(s) in Cloudinary`,
    );

    // Find which keys have no MongoDB record
    const orphans = await findOrphans(cloudinaryKeys, runId);

    if (orphans.length === 0) {
      console.log(`[OrphanJob:${runId}] No orphans found`);
      return;
    }

    console.log(
      `[OrphanJob:${runId}] Found ${orphans.length} orphan(s) — scheduling cleanup`,
    );

    // Enqueue orphan deletions via dead-letter (with retry)
    for (const orphan of orphans) {
      await deadLetterService.enqueue({
        storageKey: orphan.publicId,
        storageProvider: "cloudinary",
        reason: "orphan_cleanup",
        fileId: null, // no associated File document
        error: null,
      });
    }

    console.log(`[OrphanJob:${runId}] Orphan detection complete`);
  } catch (err) {
    console.error(`[OrphanJob:${runId}] Detection failed:`, err.message);
  }
}

/**
 * List all files in the Cloudinary upload folder.
 * Handles pagination — Cloudinary returns max 500 per page.
 *
 * @param {string} runId
 * @returns {Promise<Array<{ publicId, createdAt }>>}
 */
async function listCloudinaryFiles(runId) {
  const results = [];
  let nextCursor = null;

  do {
    const options = {
      type: "upload",
      prefix: env.cloudinary.uploadFolder + "/",
      resource_type: "raw",
      max_results: 500,
    };

    if (nextCursor) {
      options.next_cursor = nextCursor;
    }

    try {
      const response = await cloudinary.api.resources(options);

      for (const resource of response.resources || []) {
        results.push({
          publicId: resource.public_id,
          createdAt: new Date(resource.created_at),
        });
      }

      nextCursor = response.next_cursor || null;
    } catch (err) {
      // If listing fails (network, rate limit), abort and return what we have
      console.warn(
        `[OrphanJob:${runId}] Cloudinary listing page failed:`,
        err.message,
      );
      break;
    }
  } while (nextCursor);

  return results;
}

/**
 * Cross-reference Cloudinary keys against MongoDB.
 * Returns keys that have no File document AND are older than GRACE_PERIOD_MS.
 *
 * @param {Array<{ publicId, createdAt }>} cloudinaryFiles
 * @param {string} runId
 * @returns {Promise<Array<{ publicId }>>}
 */
async function findOrphans(cloudinaryFiles, runId) {
  const graceThreshold = new Date(Date.now() - GRACE_PERIOD_MS);

  // Only consider files older than the grace period
  const candidates = cloudinaryFiles.filter(
    (f) => f.createdAt < graceThreshold,
  );

  if (candidates.length === 0) return [];

  console.log(
    `[OrphanJob:${runId}] ${candidates.length} candidate(s) past grace period`,
  );

  const orphans = [];

  // Check in batches of 100 to avoid huge $in queries
  for (let i = 0; i < candidates.length; i += 100) {
    const batch = candidates.slice(i, i + 100);
    const publicIds = batch.map((f) => f.publicId);

    // Find which of these public_ids have a File document
    const existingFiles = await File.find(
      { storageKey: { $in: publicIds } },
      { storageKey: 1 },
    ).lean();

    const existingKeys = new Set(existingFiles.map((f) => f.storageKey));

    // Any public_id not in MongoDB is an orphan
    for (const candidate of batch) {
      if (!existingKeys.has(candidate.publicId)) {
        orphans.push({ publicId: candidate.publicId });
      }
    }
  }

  return orphans;
}

/**
 * Start the orphan detection cron job.
 * Runs every hour — Cloudinary Admin API rate limits prevent more frequent runs.
 *
 * @param {Object} options
 * @param {boolean} options.runImmediately
 * @returns {cron.ScheduledTask}
 */
function startOrphanJob({ runImmediately = false } = {}) {
  if (env.nodeEnv === "test") {
    return { stop: () => {} };
  }

  if (runImmediately) {
    detectOrphans(); // fire-and-forget on startup
  }

  const job = cron.schedule("0 * * * *", detectOrphans, {
    scheduled: true,
    timezone: "UTC",
  });

  console.log("[OrphanJob] Scheduled — runs every hour (UTC)");

  return job;
}

module.exports = { startOrphanJob, detectOrphans };
