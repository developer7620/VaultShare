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

// ─── Download flow ─────────────────────────────────────────────────────────
router.get("/:id", generalLimiter, fileController.getMeta);
router.post(
  "/:id/download",
  downloadLimiter,
  validate(downloadFileSchema),
  fileController.download,
);

// ─── Lifecycle management ──────────────────────────────────────────────────

/**
 * GET /api/files/:id/status
 * Full lifecycle state — for uploader dashboards.
 * Must be registered BEFORE /:id to avoid Express matching /status as an ID.
 *
 * Route ordering is critical in Express: /:id/status must come before
 * any catch-all /:id route or Express will treat 'status' as a fileId.
 * Here it's fine because /:id only handles GET and our status route
 * specifies the full path /:id/status.
 */
router.get("/:id/status", generalLimiter, fileController.getStatus);

/**
 * DELETE /api/files/:id
 * Soft delete — marks as deleted and removes from Cloudinary.
 */
router.delete("/:id", generalLimiter, fileController.deleteFile);

module.exports = router;
