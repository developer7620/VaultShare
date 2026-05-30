/**
 * Centralised environment configuration with fail-fast validation.
 *
 * Engineering decision: we validate ALL required vars here, collect every
 * missing one, then throw a single error listing all problems. This is better
 * than crashing on the first missing var — operators see everything they need
 * to fix in one deploy attempt.
 */

"use strict";

const REQUIRED_VARS = [
  "MONGODB_URI",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "PORT",
];

function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    // Use process.stderr so this appears even if stdout is redirected
    process.stderr.write(
      `\n[VaultShare] FATAL — Missing required environment variables:\n` +
        missing.map((k) => `  • ${k}`).join("\n") +
        `\n\nCopy .env.example to .env and fill in all values.\n\n`,
    );
    process.exit(1);
  }
}

// Run immediately when this module is imported
validateEnv();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10),
  mongodbUri: process.env.MONGODB_URI,

  storageProvider: process.env.STORAGE_PROVIDER || "cloudinary",

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    uploadFolder: process.env.CLOUDINARY_UPLOAD_FOLDER || "vaultshare",
    signatureExpirySeconds: 3600,
  },

  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || null,
    bucket: process.env.AWS_S3_BUCKET || null,
    // Optional: CloudFront distribution domain for CDN delivery
    cloudfrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN || null,
    // Upload URL TTL (presigned PUT) — 1 hour max
    uploadUrlTtlSeconds: parseInt(process.env.AWS_UPLOAD_URL_TTL || "3600", 10),
  },

  // How long a signed delivery URL stays valid (seconds)
  signedUrlTtlSeconds: parseInt(process.env.SIGNED_URL_TTL_SECONDS || "60", 10),

  // bcrypt cost factor — higher = slower hash = more brute-force resistant
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12", 10),

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 min
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  },

  redis: {
    // Optional — if not set, falls back to in-memory store
    url: process.env.REDIS_URL || null,
    // Prefix all VaultShare keys to avoid collisions with other apps
    keyPrefix: process.env.REDIS_KEY_PREFIX || "vaultshare:",
  },

  security: {
    // Maximum total failed attempts per file before global lockout
    maxGlobalAttemptsPerFile: parseInt(
      process.env.MAX_GLOBAL_ATTEMPTS_PER_FILE || "20",
      10,
    ),
    // Per-IP attempts before lockout (Day 7 — surfaced here for clarity)
    maxAttemptsPerIp: parseInt(process.env.MAX_ATTEMPTS_PER_IP || "5", 10),
    // Lockout duration in ms
    lockoutMs: parseInt(process.env.LOCKOUT_MS || String(15 * 60 * 1000), 10),
  },
};

module.exports = env;
