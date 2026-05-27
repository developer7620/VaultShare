/**
 * Updated file.routes.js — complete file with all 4 routes
 */

"use strict";

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const fileController = require("../controllers/file.controller");
const validate = require("../middleware/validate");
const {
  generalLimiter,
  downloadLimiter,
} = require("../middleware/rateLimiter");
const {
  signUploadSchema,
  registerFileSchema,
  downloadFileSchema,
} = require("../validation/file.schemas");

// Stricter rate limit for register (Day 4 — kept here for completeness)
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const AppError = require("../utils/AppError");
    next(
      AppError.tooManyRequests(
        "Too many upload attempts. Please try again later.",
      ),
    );
  },
});

// ─── Upload flow (Day 4) ───────────────────────────────────────────────────

router.post(
  "/sign",
  generalLimiter,
  validate(signUploadSchema),
  fileController.sign,
);

router.post(
  "/register",
  registerLimiter,
  validate(registerFileSchema),
  fileController.register,
);

// ─── Download flow (Day 5) ─────────────────────────────────────────────────

/**
 * GET /api/files/:id
 * Fetch public metadata — no counter decrement, no signed URL
 * Rate limit: generous (100/15min) — read-only, cheap query
 */
router.get("/:id", generalLimiter, fileController.getMeta);

/**
 * POST /api/files/:id/download
 * Verify access and return signed URL — decrements download counter
 * Rate limit: strict (10/15min) — prevents password brute-forcing
 *
 * Uses downloadLimiter from Day 2's rateLimiter.js.
 * Day 9 adds per-file IP tracking on top of this global limit.
 */
router.post(
  "/:id/download",
  downloadLimiter,
  validate(downloadFileSchema),
  fileController.download,
);

module.exports = router;
