/**
 * Cryptographic utilities.
 *
 * IP hashing: we store SHA-256(ip) in the audit log, never the raw IP.
 * This is a GDPR-compliant pattern — the hash is useful for abuse detection
 * (same IP downloading the same file 100 times) without storing PII.
 *
 * Note: SHA-256(ip) is NOT a secret hash — an attacker with a list of IPs
 * could reverse it. For higher privacy, use HMAC-SHA256 with a secret key.
 * For VaultShare's threat model (abuse detection, not cryptographic identity
 * protection), plain SHA-256 is the right trade-off.
 */

"use strict";

const crypto = require("crypto");

/**
 * @param {string} ip - Raw IP address (IPv4 or IPv6)
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashIp(ip) {
  if (!ip || typeof ip !== "string") {
    return crypto.createHash("sha256").update("unknown").digest("hex");
  }

  // Normalise: strip IPv6 prefix for IPv4-mapped addresses (::ffff:1.2.3.4 → 1.2.3.4)
  const normalised = ip.replace(/^::ffff:/, "");

  return crypto.createHash("sha256").update(normalised).digest("hex");
}

module.exports = { hashIp };
