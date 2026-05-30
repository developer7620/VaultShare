/**
 * Admin controller — thin HTTP layer over admin.service.js.
 *
 * Same rules as file.controller.js:
 *   - Parse req, call service, send res
 *   - No business logic here
 *   - Always asyncHandler
 */

"use strict";

const adminService = require("../services/admin.service");
const asyncHandler = require("../utils/asyncHandler");

/**
 * GET /api/admin/files
 * Query params: page, limit, status, sortBy, sortOrder, search,
 *               createdAfter, createdBefore
 */
const listFiles = asyncHandler(async (req, res) => {
  const {
    page = "0",
    limit,
    status = "all",
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
    createdAfter,
    createdBefore,
  } = req.query;

  const result = await adminService.listFiles({
    page: Math.max(0, parseInt(page, 10)),
    limit: limit ? parseInt(limit, 10) : undefined,
    status,
    sortBy,
    sortOrder,
    search,
    createdAfter,
    createdBefore,
  });

  res.status(200).json({ success: true, data: result });
});

/**
 * GET /api/admin/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const result = await adminService.getStats();
  res.status(200).json({ success: true, data: result });
});

/**
 * GET /api/admin/files/:id/downloads
 */
const getDownloadLog = asyncHandler(async (req, res) => {
  const result = await adminService.getFileDownloadLog(req.params.id);
  res.status(200).json({ success: true, data: result });
});

/**
 * DELETE /api/admin/files/:id
 * Force delete — no upload token required
 */
const deleteFile = asyncHandler(async (req, res) => {
  const result = await adminService.adminDeleteFile(req.params.id);
  res.status(200).json({ success: true, data: result });
});

/**
 * GET /api/admin/orphans
 * Files pending storage cleanup
 */
const getOrphans = asyncHandler(async (req, res) => {
  const files = await adminService.getOrphanedFiles();
  res.status(200).json({
    success: true,
    data: { count: files.length, files },
  });
});

const getDeadLetterStats = asyncHandler(async (req, res) => {
  const deadLetterService = require("../services/deadLetter.service");
  const stats = await deadLetterService.getQueueStats();
  res.status(200).json({ success: true, data: stats });
});

module.exports = {
  listFiles,
  getStats,
  getDownloadLog,
  deleteFile,
  getOrphans,
  getDeadLetterStats,
};
