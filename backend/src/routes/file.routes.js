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
router.get("/:id/status", generalLimiter, fileController.getStatus);

// extractToken parses Authorization: Bearer <token> before deleteFile runs
router.delete("/:id", generalLimiter, extractToken, fileController.deleteFile);

module.exports = router;
