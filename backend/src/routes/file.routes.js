/**
 * File routes.
 *
 * Route design decisions:
 *
 * POST /api/files/sign     — not GET because it's not idempotent.
 *                            Two identical POST /sign calls at different
 *                            times produce different signatures (different
 *                            timestamps). GET implies cacheability — wrong here.
 *
 * POST /api/files/register — creates a resource (File document), so POST.
 *                            Returns 201. The resource ID comes back in the
 *                            response, not from a URL segment.
 *
 * Validation middleware runs before the controller. If Joi rejects the body,
 * the controller never executes — no wasted service/DB calls.
 *
 * Rate limiters are applied per-route with different thresholds:
 *   - sign: generous (100/15min) — just crypto, no DB
 *   - register: strict (20/15min) — creates DB records + calls Cloudinary API
 */

"use strict";

const router = require("express").Router();
const fileController = require("../controllers/file.controller");
const validate = require("../middleware/validate");
const { generalLimiter } = require("../middleware/rateLimiter");
const {
  signUploadSchema,
  registerFileSchema,
} = require("../validation/file.schemas");

// Stricter rate limit for register — it makes external API calls + DB writes
const rateLimit = require("express-rate-limit");
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

// ─── Upload flow ───────────────────────────────────────────────────────────

/**
 * POST /api/files/sign
 * Get upload credentials for direct Cloudinary upload
 */
router.post(
  "/sign",
  generalLimiter,
  validate(signUploadSchema),
  fileController.sign,
);

/**
 * POST /api/files/register
 * Register a file after direct upload to Cloudinary
 */
router.post(
  "/register",
  registerLimiter,
  validate(registerFileSchema),
  fileController.register,
);

module.exports = router;
