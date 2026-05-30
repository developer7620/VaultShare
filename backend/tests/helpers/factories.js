/**
 * Test data factories — create valid MongoDB documents for testing.
 *
 * Using factories instead of inline objects means:
 *   1. Tests are readable — factory names communicate intent
 *   2. Schema changes break factories (not 50 inline objects)
 *   3. Override only what the test cares about
 *
 * Usage:
 *   const file = await createActiveFile({ maxDownloads: 1 });
 *   const file = await createPasswordProtectedFile({ password: 'test' });
 */

"use strict";

const bcrypt = require("bcrypt");
const File = require("../../src/models/File.model");

const BCRYPT_ROUNDS = 4; // Minimum for tests — fast, not secure

/**
 * Base file document — all required fields with sensible defaults.
 * Override any field by passing an object.
 */
async function createActiveFile(overrides = {}) {
  return File.create({
    storageKey: `vaultshare/test-${Date.now()}`,
    storageProvider: "cloudinary",
    originalName: "test-file.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    isPasswordProtected: false,
    passwordHash: null,
    maxDownloads: null,
    downloadsRemaining: null,
    status: "active",
    expiresAt: null,
    ...overrides,
  });
}

/**
 * Create a password-protected file.
 * Hashes the password with a low cost factor for test speed.
 */
async function createPasswordProtectedFile(
  password = "testpassword",
  overrides = {},
) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return createActiveFile({
    isPasswordProtected: true,
    passwordHash,
    ...overrides,
  });
}

/**
 * Create a file with a download limit.
 */
async function createLimitedFile(maxDownloads = 3, overrides = {}) {
  return createActiveFile({
    maxDownloads,
    downloadsRemaining: maxDownloads,
    ...overrides,
  });
}

/**
 * Create an already-expired file.
 */
async function createExpiredFile(overrides = {}) {
  return createActiveFile({
    expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    status: "active", // status not yet updated by cron — this is the gap
    ...overrides,
  });
}

/**
 * Create a file expiring in the future.
 */
async function createExpiringFile(expiresInMs = 60000, overrides = {}) {
  return createActiveFile({
    expiresAt: new Date(Date.now() + expiresInMs),
    ...overrides,
  });
}

module.exports = {
  createActiveFile,
  createPasswordProtectedFile,
  createLimitedFile,
  createExpiredFile,
  createExpiringFile,
};
