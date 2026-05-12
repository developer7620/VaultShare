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
};

module.exports = env;
