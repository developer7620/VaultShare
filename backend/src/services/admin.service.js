/**
 * Admin service — file management and stats for operators.
 *
 * Separated from file.service.js because admin operations have
 * different concerns:
 *   - No authentication checks (admin bypasses upload token)
 *   - Full access to all file states (expired, deleted)
 *   - Aggregation queries (stats)
 *   - Pagination (listing)
 *
 * Controllers call this. Nothing else should.
 */

"use strict";

const File = require("../models/File.model");
const AppError = require("../utils/AppError");
const env = require("../config/env");

// ─── File listing ──────────────────────────────────────────────────────────

/**
 * listFiles
 *
 * Returns a paginated list of files with optional filters.
 *
 * @param {Object} params
 * @param {number} params.page        - 0-indexed page number
 * @param {number} params.limit       - Results per page (max: ADMIN_PAGE_SIZE)
 * @param {string} params.status      - Filter by status ('active','expired','deleted','all')
 * @param {string} params.sortBy      - Field to sort by ('createdAt','sizeBytes','downloadCount')
 * @param {string} params.sortOrder   - 'asc' or 'desc'
 * @param {string} params.search      - Partial match on originalName
 * @param {Date}   params.createdAfter
 * @param {Date}   params.createdBefore
 * @returns {Promise<{ files, total, page, totalPages }>}
 */
async function listFiles({
  page = 0,
  limit,
  status = "all",
  sortBy = "createdAt",
  sortOrder = "desc",
  search,
  createdAfter,
  createdBefore,
} = {}) {
  // Cap limit at configured page size
  const pageSize = Math.min(limit || env.admin.pageSize, env.admin.pageSize);

  // ── Build filter ────────────────────────────────────────────────────────
  const filter = {};

  if (status !== "all") {
    const validStatuses = ["active", "expired", "deleted"];
    if (!validStatuses.includes(status)) {
      throw AppError.badRequest(
        `Invalid status filter. Must be one of: ${validStatuses.join(", ")}, all`,
        "INVALID_FILTER",
      );
    }
    filter.status = status;
  }

  if (search) {
    // Case-insensitive partial match on filename
    // $options: 'i' = case-insensitive
    // Note: this does a collection scan unless originalName is indexed.
    // For large collections, add a text index on originalName.
    filter.originalName = { $regex: search, $options: "i" };
  }

  if (createdAfter || createdBefore) {
    filter.createdAt = {};
    if (createdAfter) filter.createdAt.$gte = new Date(createdAfter);
    if (createdBefore) filter.createdAt.$lte = new Date(createdBefore);
  }

  // ── Build sort ──────────────────────────────────────────────────────────
  const allowedSortFields = [
    "createdAt",
    "sizeBytes",
    "downloadCount",
    "originalName",
  ];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
  const sort = { [sortField]: sortOrder === "asc" ? 1 : -1 };

  // ── Execute queries concurrently ────────────────────────────────────────
  // countDocuments + find in parallel — same filter, one round trip each
  const [total, files] = await Promise.all([
    File.countDocuments(filter),
    File.find(filter)
      .sort(sort)
      .skip(page * pageSize)
      .limit(pageSize)
      // Projection: exclude heavy fields from list view
      // Full downloads audit is in a separate endpoint
      .select("-downloads -passwordHash -uploadTokenHash")
      .lean(),
  ]);

  return {
    files,
    total,
    page,
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasNextPage: (page + 1) * pageSize < total,
    hasPrevPage: page > 0,
  };
}

// ─── Stats ─────────────────────────────────────────────────────────────────

/**
 * getStats
 *
 * Returns aggregated usage statistics.
 * Uses MongoDB aggregation pipeline — computed server-side.
 *
 * @returns {Promise<Object>}
 */
async function getStats() {
  // ── Aggregation pipeline ────────────────────────────────────────────────
  // Group by status, compute totals
  const [statusAgg, recentAgg] = await Promise.all([
    // Per-status breakdown
    File.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalBytes: { $sum: "$sizeBytes" },
          totalDownloads: { $sum: "$downloadCount" },
        },
      },
    ]),

    // Files created in the last 7 days (upload activity trend)
    File.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: {
            // Group by calendar day (UTC)
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
          bytes: { $sum: "$sizeBytes" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // ── Format status breakdown ─────────────────────────────────────────────
  const byStatus = { active: null, expired: null, deleted: null };

  for (const row of statusAgg) {
    byStatus[row._id] = {
      count: row.count,
      totalBytes: row.totalBytes,
      totalDownloads: row.totalDownloads,
      humanReadableSize: formatBytes(row.totalBytes),
    };
  }

  // Fill in zeros for statuses with no documents
  for (const status of ["active", "expired", "deleted"]) {
    if (!byStatus[status]) {
      byStatus[status] = {
        count: 0,
        totalBytes: 0,
        totalDownloads: 0,
        humanReadableSize: "0 B",
      };
    }
  }

  // ── Compute totals ──────────────────────────────────────────────────────
  const totalCount = Object.values(byStatus).reduce((s, v) => s + v.count, 0);
  const totalBytes = Object.values(byStatus).reduce(
    (s, v) => s + v.totalBytes,
    0,
  );
  const totalDownloads = Object.values(byStatus).reduce(
    (s, v) => s + v.totalDownloads,
    0,
  );

  // ── Files expiring soon (next 24 hours) ────────────────────────────────
  const expiringSoon = await File.countDocuments({
    status: "active",
    expiresAt: {
      $gte: new Date(),
      $lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return {
    totals: {
      files: totalCount,
      activeFiles: byStatus.active.count,
      storageBytes: totalBytes,
      humanReadableStorage: formatBytes(totalBytes),
      downloads: totalDownloads,
    },
    byStatus,
    expiringSoon,
    uploadTrend: recentAgg.map((d) => ({
      date: d._id,
      count: d.count,
      bytes: d.bytes,
    })),
    generatedAt: new Date().toISOString(),
  };
}

// ─── File detail ───────────────────────────────────────────────────────────

/**
 * getFileDownloadLog
 *
 * Returns the full download audit trail for a specific file.
 * This is the only endpoint that exposes the downloads array.
 *
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
async function getFileDownloadLog(fileId) {
  // Select ONLY the fields needed — don't pull passwordHash/uploadTokenHash
  const file = await File.findById(fileId)
    .select(
      "originalName status downloadCount maxDownloads downloads createdAt",
    )
    .lean();

  if (!file) {
    throw AppError.notFound("File not found.");
  }

  return {
    fileId: file._id,
    originalName: file.originalName,
    status: file.status,
    downloadCount: file.downloadCount,
    maxDownloads: file.maxDownloads,
    createdAt: file.createdAt,
    downloads: file.downloads.map((d) => ({
      downloadedAt: d.downloadedAt,
      // Return ipHash as-is — it's already anonymised (SHA-256)
      ipHash: d.ipHash,
      userAgent: d.userAgent,
    })),
  };
}

// ─── Force delete ──────────────────────────────────────────────────────────

/**
 * adminDeleteFile
 *
 * Hard delete — bypasses upload token check.
 * Updates MongoDB first (same ordering principle as soft delete),
 * then removes from storage.
 *
 * @param {string} fileId
 * @returns {Promise<void>}
 */
async function adminDeleteFile(fileId) {
  const file = await File.findById(fileId);

  if (!file) {
    throw AppError.notFound("File not found.");
  }

  // Idempotent — already deleted is fine
  if (file.status === "deleted") {
    return { message: "File was already deleted." };
  }

  // Step 1: Mark deleted in MongoDB first
  await File.updateOne({ _id: fileId }, { $set: { status: "deleted" } });

  // Step 2: Delete from storage (best-effort)
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
        `[AdminService] Storage deletion failed for ${fileId}:`,
        err.message,
      );
    }
  }

  return { message: "File deleted successfully." };
}

// ─── Orphan detection ──────────────────────────────────────────────────────

/**
 * getOrphanedFiles
 *
 * Returns File documents in 'expired' or 'deleted' status
 * that still have a storageKey set (storage deletion pending/failed).
 *
 * Useful for debugging — lets you see what the cron job will clean up.
 *
 * @returns {Promise<Array>}
 */
async function getOrphanedFiles() {
  return File.find(
    {
      status: { $in: ["expired", "deleted"] },
      storageKey: { $ne: null },
    },
    { _id: 1, storageKey: 1, storageProvider: 1, status: 1, updatedAt: 1 },
  ).lean();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

module.exports = {
  listFiles,
  getStats,
  getFileDownloadLog,
  adminDeleteFile,
  getOrphanedFiles,
};
