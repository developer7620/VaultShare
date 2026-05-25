/**
 * Joi validation schemas for file-related endpoints.
 *
 * Kept in a dedicated file so schemas are:
 *   - Reusable across routes and tests
 *   - Easy to audit ("what does this endpoint accept?")
 *   - Separated from business logic
 *
 * MIME type allowlist: we define what we accept, not what we reject.
 * A denylist approach ("block .exe") is always incomplete — attackers
 * find file types you didn't think to block. Allowlisting is safer.
 */

"use strict";

const Joi = require("joi");

// Common MIME types VaultShare accepts.
// Cloudinary's server-side validation is a second layer on top of this.
const ALLOWED_MIME_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Video
  "video/mp4",
  "video/webm",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
];

const MAX_FILE_SIZE_BYTES = 104_857_600; // 100MB
const MAX_PASSWORD_LENGTH = 128;
const MAX_FILENAME_LENGTH = 255;

/**
 * Schema for POST /api/files/sign
 *
 * The client sends metadata about the file it's about to upload.
 * We use this to:
 *   1. Validate the file is acceptable before the client wastes time uploading
 *   2. Include size constraints in the Cloudinary signature
 */
const signUploadSchema = Joi.object({
  originalName: Joi.string()
    .trim()
    .min(1)
    .max(MAX_FILENAME_LENGTH)
    .required()
    .messages({
      "string.empty": "Filename is required",
      "string.max": `Filename cannot exceed ${MAX_FILENAME_LENGTH} characters`,
    }),

  mimeType: Joi.string()
    .valid(...ALLOWED_MIME_TYPES)
    .required()
    .messages({
      "any.only": "File type is not supported",
      "string.empty": "MIME type is required",
    }),

  sizeBytes: Joi.number()
    .integer()
    .min(1)
    .max(MAX_FILE_SIZE_BYTES)
    .required()
    .messages({
      "number.max": "File size exceeds the 100MB limit",
      "number.min": "File size must be at least 1 byte",
    }),
});

/**
 * Schema for POST /api/files/register
 *
 * Called by the client after a successful Cloudinary upload.
 * storageKey is the public_id Cloudinary returned — we validate it
 * exists in our Cloudinary account before creating the DB record.
 */
const registerFileSchema = Joi.object({
  // Cloudinary public_id — must be in our folder
  storageKey: Joi.string().trim().min(1).max(500).required().messages({
    "string.empty": "Storage key is required",
  }),

  originalName: Joi.string().trim().min(1).max(MAX_FILENAME_LENGTH).required(),

  mimeType: Joi.string()
    .valid(...ALLOWED_MIME_TYPES)
    .required(),

  sizeBytes: Joi.number().integer().min(1).max(MAX_FILE_SIZE_BYTES).required(),

  // Optional password — if provided, file is password-protected
  password: Joi.string()
    .min(4)
    .max(MAX_PASSWORD_LENGTH)
    .optional()
    .allow(null, "")
    .messages({
      "string.min": "Password must be at least 4 characters",
    }),

  // null = unlimited downloads
  maxDownloads: Joi.number()
    .integer()
    .min(1)
    .max(10_000)
    .optional()
    .allow(null)
    .default(null),

  // null = never expires. ISO 8601 string, must be in the future.
  expiresAt: Joi.date()
    .iso()
    .greater("now")
    .optional()
    .allow(null)
    .default(null)
    .messages({
      "date.greater": "Expiry date must be in the future",
    }),
});

module.exports = {
  signUploadSchema,
  registerFileSchema,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
};
