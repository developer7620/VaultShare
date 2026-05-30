"use strict";

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const fileController = require("../controllers/file.controller");
const validate = require("../middleware/validate");
const {
  generalLimiter,
  downloadLimiter,
} = require("../middleware/rateLimiter");
const extractToken = require("../middleware/extractToken");
const securityHeaders = require("../middleware/securityHeaders");
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
  securityHeaders.upload,
  generalLimiter,
  validate(signUploadSchema),
  fileController.sign,
);

router.post(
  "/register",
  securityHeaders.upload,
  registerLimiter,
  validate(registerFileSchema),
  fileController.register,
);

// ─── Download flow ─────────────────────────────────────────────────────────
router.get("/:id", securityHeaders.api, generalLimiter, fileController.getMeta);

router.post(
  "/:id/download",
  securityHeaders.download,
  downloadLimiter,
  validate(downloadFileSchema),
  fileController.download,
);

// ─── Lifecycle management ──────────────────────────────────────────────────
router.get(
  "/:id/status",
  securityHeaders.api,
  generalLimiter,
  fileController.getStatus,
);

router.delete(
  "/:id",
  securityHeaders.api,
  generalLimiter,
  extractToken,
  fileController.deleteFile,
);

module.exports = router;
