/**
 * Attempt tracker — two-layer brute-force protection.
 *
 * Layer 1: Per (fileId, fingerprint) — locks out a specific client
 *   after MAX_ATTEMPTS_PER_IP failures. Day 7 logic, now using
 *   the shared store for Redis compatibility.
 *
 * Layer 2: Per (fileId) global — locks out ALL access to a file
 *   after MAX_GLOBAL_ATTEMPTS total failures. Defeats IP rotation.
 *
 * Fingerprint = hash(ip + userAgent + acceptLanguage)
 * More stable than IP alone, harder to rotate than IP alone.
 *
 * Key schema:
 *   attempt:ip:{fileId}:{fingerprint}  → per-client counter
 *   attempt:global:{fileId}            → global counter
 *   lock:ip:{fileId}:{fingerprint}     → lockout marker
 *   lock:global:{fileId}               → global lockout marker
 */

"use strict";

const crypto = require("crypto");
const store = require("./rateLimitStore");
const env = require("../config/env");

const MAX_PER_IP = env.security?.maxAttemptsPerIp || 5;
const MAX_GLOBAL = env.security?.maxGlobalAttemptsPerFile || 20;
const LOCKOUT_MS = env.security?.lockoutMs || 15 * 60 * 1000;

// ─── Fingerprinting ────────────────────────────────────────────────────────

/**
 * Build a request fingerprint from multiple signals.
 * More stable than IP alone for rate limiting purposes.
 *
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} acceptLanguage
 * @returns {string} 16-char hex fingerprint
 */
function buildFingerprint(ip, userAgent = "", acceptLanguage = "") {
  const raw = [
    ip || "unknown",
    userAgent.substring(0, 100),
    acceptLanguage.substring(0, 50),
  ].join("|");

  // 8 bytes = 16 hex chars — short enough for Map keys, unique enough
  return crypto.createHash("sha256").update(raw).digest("hex").substring(0, 16);
}

// ─── Key builders ──────────────────────────────────────────────────────────

const keys = {
  ipAttempt: (fileId, fp) => `attempt:ip:${fileId}:${fp}`,
  ipLock: (fileId, fp) => `lock:ip:${fileId}:${fp}`,
  globalAttempt: (fileId) => `attempt:global:${fileId}`,
  globalLock: (fileId) => `lock:global:${fileId}`,
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Check if a request is locked out before touching the DB.
 * Checks both layers — per-client and global.
 *
 * @param {string} fileId
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} acceptLanguage
 * @returns {Promise<{ locked: boolean, reason: string|null, remainingMs: number }>}
 */
async function isLocked(fileId, ip, userAgent, acceptLanguage) {
  const fp = buildFingerprint(ip, userAgent, acceptLanguage);

  // Check global lockout first (affects all clients — cheapest to check)
  const globalLock = await store.get(keys.globalLock(fileId));
  if (globalLock) {
    return {
      locked: true,
      reason: "GLOBAL_LOCKOUT",
      remainingMs: globalLock.ttlMs,
    };
  }

  // Check per-client lockout
  const ipLock = await store.get(keys.ipLock(fileId, fp));
  if (ipLock) {
    return {
      locked: true,
      reason: "IP_LOCKOUT",
      remainingMs: ipLock.ttlMs,
    };
  }

  return { locked: false, reason: null, remainingMs: 0 };
}

/**
 * Record a failed attempt. Updates both per-client and global counters.
 * Sets lockout markers if thresholds are crossed.
 *
 * @param {string} fileId
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} acceptLanguage
 * @returns {Promise<{
 *   locked: boolean,
 *   globalLocked: boolean,
 *   attemptsRemainingIp: number,
 *   attemptsRemainingGlobal: number
 * }>}
 */
async function recordFailure(fileId, ip, userAgent, acceptLanguage) {
  const fp = buildFingerprint(ip, userAgent, acceptLanguage);

  // Increment both counters concurrently
  const [ipResult, globalResult] = await Promise.all([
    store.increment(keys.ipAttempt(fileId, fp), LOCKOUT_MS),
    store.increment(keys.globalAttempt(fileId), LOCKOUT_MS),
  ]);

  let ipLocked = false;
  let globalLocked = false;

  // Check per-client threshold
  if (ipResult.count >= MAX_PER_IP) {
    await store.increment(keys.ipLock(fileId, fp), LOCKOUT_MS);
    ipLocked = true;
  }

  // Check global threshold
  if (globalResult.count >= MAX_GLOBAL) {
    await store.increment(keys.globalLock(fileId), LOCKOUT_MS);
    globalLocked = true;
  }

  return {
    locked: ipLocked || globalLocked,
    globalLocked,
    attemptsRemainingIp: Math.max(0, MAX_PER_IP - ipResult.count),
    attemptsRemainingGlobal: Math.max(0, MAX_GLOBAL - globalResult.count),
  };
}

/**
 * Reset all attempt counters for a (fileId, client) pair.
 * Called after a successful download — clears per-client counter only.
 * Global counter is NOT reset (prevents gaming via 1 correct password).
 *
 * @param {string} fileId
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} acceptLanguage
 */
async function resetClientAttempts(fileId, ip, userAgent, acceptLanguage) {
  const fp = buildFingerprint(ip, userAgent, acceptLanguage);

  await Promise.all([
    store.delete(keys.ipAttempt(fileId, fp)),
    store.delete(keys.ipLock(fileId, fp)),
  ]);
}

/**
 * Get current attempt info for debugging/admin endpoints.
 */
async function getAttemptInfo(fileId, ip, userAgent, acceptLanguage) {
  const fp = buildFingerprint(ip, userAgent, acceptLanguage);

  const [ipAttempt, globalAttempt, ipLock, globalLock] = await Promise.all([
    store.get(keys.ipAttempt(fileId, fp)),
    store.get(keys.globalAttempt(fileId)),
    store.get(keys.ipLock(fileId, fp)),
    store.get(keys.globalLock(fileId)),
  ]);

  return {
    fingerprint: fp,
    ipAttempts: ipAttempt?.count || 0,
    globalAttempts: globalAttempt?.count || 0,
    ipLocked: !!ipLock,
    globalLocked: !!globalLock,
    ipLockRemainingMs: ipLock?.ttlMs || 0,
    globalLockRemainingMs: globalLock?.ttlMs || 0,
  };
}

module.exports = {
  isLocked,
  recordFailure,
  resetClientAttempts,
  getAttemptInfo,
  buildFingerprint,
  MAX_PER_IP,
  MAX_GLOBAL,
  LOCKOUT_MS,
};
