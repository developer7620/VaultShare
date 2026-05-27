/**
 * In-memory attempt tracker for per-file brute-force protection.
 *
 * Tracks failed download attempts per (fileId, ipHash) pair.
 * After MAX_ATTEMPTS failures, the pair is locked for LOCKOUT_MS.
 *
 * Data structure:
 *   Map<string, { count: number, lockedUntil: number | null, lastAttempt: number }>
 *   Key: `${fileId}:${ipHash}`
 *
 * Production note:
 *   Replace the Map with Redis (ioredis) for multi-process deployments.
 *   The interface (isLocked, recordFailure, reset) stays identical —
 *   only the backing store changes. This is the same abstraction pattern
 *   as the StorageProvider.
 *
 * Memory management:
 *   The Map is cleaned up every CLEANUP_INTERVAL_MS to prevent unbounded
 *   growth. Only entries older than LOCKOUT_MS are removed.
 */

"use strict";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// The in-memory store
const attempts = new Map();

/**
 * Build the key for a (fileId, ipHash) pair.
 * @param {string} fileId
 * @param {string} ipHash
 * @returns {string}
 */
function makeKey(fileId, ipHash) {
  return `${fileId}:${ipHash}`;
}

/**
 * Check if a (fileId, IP) pair is currently locked out.
 *
 * @param {string} fileId
 * @param {string} ipHash
 * @returns {{ locked: boolean, remainingMs: number }}
 */
function isLocked(fileId, ipHash) {
  const key = makeKey(fileId, ipHash);
  const entry = attempts.get(key);

  if (!entry) return { locked: false, remainingMs: 0 };

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return {
      locked: true,
      remainingMs: entry.lockedUntil - Date.now(),
    };
  }

  // Lock has expired — clean up
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    attempts.delete(key);
    return { locked: false, remainingMs: 0 };
  }

  return { locked: false, remainingMs: 0 };
}

/**
 * Record a failed attempt for a (fileId, IP) pair.
 * If MAX_ATTEMPTS is reached, sets the lockout timer.
 *
 * @param {string} fileId
 * @param {string} ipHash
 * @returns {{ locked: boolean, attemptsRemaining: number }}
 */
function recordFailure(fileId, ipHash) {
  const key = makeKey(fileId, ipHash);
  const entry = attempts.get(key) || {
    count: 0,
    lockedUntil: null,
    lastAttempt: Date.now(),
  };

  entry.count += 1;
  entry.lastAttempt = Date.now();

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    attempts.set(key, entry);
    return { locked: true, attemptsRemaining: 0 };
  }

  attempts.set(key, entry);
  return {
    locked: false,
    attemptsRemaining: MAX_ATTEMPTS - entry.count,
  };
}

/**
 * Reset the attempt counter for a (fileId, IP) pair.
 * Called after a successful download (correct password).
 *
 * @param {string} fileId
 * @param {string} ipHash
 */
function resetAttempts(fileId, ipHash) {
  attempts.delete(makeKey(fileId, ipHash));
}

/**
 * Get current attempt info without modifying state.
 * Used for logging and debug endpoints.
 *
 * @param {string} fileId
 * @param {string} ipHash
 * @returns {{ count: number, lockedUntil: number | null } | null}
 */
function getAttemptInfo(fileId, ipHash) {
  return attempts.get(makeKey(fileId, ipHash)) || null;
}

// ─── Memory cleanup ────────────────────────────────────────────────────────
// Remove stale entries every hour to prevent unbounded Map growth.
// Only entries where the lockout has expired AND no recent activity are removed.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of attempts.entries()) {
    const isExpiredLock = entry.lockedUntil && now >= entry.lockedUntil;
    const isStale = now - entry.lastAttempt > LOCKOUT_MS;

    if (isExpiredLock || isStale) {
      attempts.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[AttemptTracker] Cleaned up ${removed} stale entries`);
  }
}, CLEANUP_INTERVAL_MS);

// Prevent the interval from keeping the process alive during shutdown
cleanupInterval.unref();

module.exports = {
  isLocked,
  recordFailure,
  resetAttempts,
  getAttemptInfo,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
};
