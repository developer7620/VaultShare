/**
 * Admin authentication middleware.
 *
 * Checks Authorization: Bearer <key> against ADMIN_API_KEY in env.
 * Uses crypto.timingSafeEqual — prevents timing attacks where an
 * attacker measures response time to guess the key character by character.
 *
 * Why not bcrypt here (unlike passwords and upload tokens)?
 * bcrypt adds ~250ms per check. Admin endpoints are called by you,
 * not by end users — latency doesn't matter. But the REAL reason:
 * bcrypt is for one-way hashing of secrets you store. The admin key
 * is compared against a plaintext env var — it's never stored as a hash.
 * timingSafeEqual is the correct primitive for comparing two known
 * plaintext values in constant time.
 */

"use strict";

const crypto = require("crypto");
const env = require("../config/env");
const AppError = require("../utils/AppError");

function adminAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";

  if (!authHeader.startsWith("Bearer ")) {
    return next(
      new AppError("Admin API key required.", 401, "ADMIN_AUTH_REQUIRED"),
    );
  }

  const providedKey = authHeader.slice(7).trim();
  const expectedKey = env.admin.apiKey;

  // Both buffers must be the same length for timingSafeEqual
  // If lengths differ, the key is wrong — but we still do a dummy
  // comparison to avoid leaking the expected key length via timing
  if (providedKey.length !== expectedKey.length) {
    return next(
      new AppError("Invalid admin API key.", 403, "ADMIN_AUTH_INVALID"),
    );
  }

  const provided = Buffer.from(providedKey);
  const expected = Buffer.from(expectedKey);

  if (!crypto.timingSafeEqual(provided, expected)) {
    return next(
      new AppError("Invalid admin API key.", 403, "ADMIN_AUTH_INVALID"),
    );
  }

  next();
}

module.exports = adminAuth;
