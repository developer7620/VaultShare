/**
 * Rate limiting middleware using express-rate-limit.
 *
 * Engineering decision: we define multiple limiters with different thresholds:
 * - General API limiter: 100 requests / 15 min (applied globally)
 * - Download limiter: 10 requests / 15 min (applied to download route only)
 *
 * The download limiter is intentionally strict — it's the primary attack surface
 * for password brute-forcing. Day 9 adds per-file IP tracking on top of this.
 *
 * In production: replace the in-memory store with a Redis store
 * (rate-limit-redis) so limits are shared across multiple Node processes.
 * The in-memory store resets on every process restart — not suitable for prod.
 */

"use strict";

const rateLimit = require("express-rate-limit");
const AppError = require("../utils/AppError");

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers (deprecated)
  handler: (req, res, next) => {
    next(
      AppError.tooManyRequests(
        "Too many requests from this IP. Please try again in 15 minutes.",
      ),
    );
  },
});

// Stricter limit for download endpoint (brute-force password protection)
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(
      AppError.tooManyRequests(
        "Too many download attempts. Please wait before trying again.",
      ),
    );
  },
});

module.exports = { generalLimiter, downloadLimiter };
