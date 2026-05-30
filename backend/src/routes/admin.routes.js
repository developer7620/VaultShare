/**
 * Admin routes — all protected by adminAuth middleware.
 *
 * Rate limiting: much stricter than public routes.
 * These endpoints return sensitive data and do expensive aggregations.
 *
 * All admin routes are under /api/admin — clearly separated from
 * public /api/files routes. Different middleware stack, different limits.
 *
 * Route ordering note:
 *   /files/:id/downloads must be registered before /files/:id
 *   or Express matches 'downloads' as an ID.
 */

"use strict";

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const adminController = require("../controllers/admin.controller");
const adminAuth = require("../middleware/adminAuth");
const deadLetterService = require("../services/deadLetter.service");

// All admin routes require the API key — applied once at router level
router.use(adminAuth);

// Strict rate limit — these endpoints are for operators, not end users
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const AppError = require("../utils/AppError");
    next(AppError.tooManyRequests("Admin rate limit exceeded."));
  },
});

router.use(adminLimiter);

// ── Stats ──────────────────────────────────────────────────────────────────
router.get("/stats", adminController.getStats);

// ── Orphan detection ───────────────────────────────────────────────────────
router.get("/orphans", adminController.getOrphans);

// ── File listing ───────────────────────────────────────────────────────────
router.get("/files", adminController.listFiles);

// ── File detail — MUST come before /files/:id ─────────────────────────────
router.get("/files/:id/downloads", adminController.getDownloadLog);

// ── Force delete ───────────────────────────────────────────────────────────
router.delete("/files/:id", adminController.deleteFile);

router.get("/dead-letter", adminController.getDeadLetterStats);

module.exports = router;
