/**
 * Upload token utilities.
 *
 * Upload tokens solve the ownership problem:
 * "Who is allowed to delete this file?"
 *
 * Design:
 *   - Generated: crypto.randomBytes(32) → 64-char hex string
 *   - Stored:    bcrypt hash in MongoDB (same as passwords)
 *   - Verified:  bcrypt.compare(provided, stored)
 *   - Returned:  once, at registration time, never again
 *
 * Why bcrypt for tokens instead of a simple hash?
 * bcrypt adds a random salt, so even if two users get the same random
 * bytes (astronomically unlikely), their stored hashes differ.
 * More importantly: bcrypt verification is the pattern the team already
 * knows — one less concept to introduce.
 *
 * In a multi-tenant system, you'd add token rotation and expiry.
 * For VaultShare's threat model (one token per file, never rotated),
 * this is the right level of complexity.
 */

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const env = require("../config/env");

/**
 * Generate a new upload token.
 * Returns { plaintext, hash } — store the hash, return the plaintext once.
 *
 * @returns {Promise<{ plaintext: string, hash: string }>}
 */
async function generateUploadToken() {
  // 32 random bytes = 256 bits of entropy = unguessable
  const plaintext = crypto.randomBytes(32).toString("hex");
  const hash = await bcrypt.hash(plaintext, env.bcryptRounds);
  return { plaintext, hash };
}

/**
 * Verify a provided token against a stored hash.
 * Timing-safe via bcrypt.
 *
 * @param {string} provided  - Token from Authorization header
 * @param {string} stored    - bcrypt hash from MongoDB
 * @returns {Promise<boolean>}
 */
async function verifyUploadToken(provided, stored) {
  if (!provided || !stored) return false;
  return bcrypt.compare(provided, stored);
}

module.exports = { generateUploadToken, verifyUploadToken };
