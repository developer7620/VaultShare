// Load .env before any module is required
require("dotenv").config();

// Override critical vars for test environment
process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.BCRYPT_ROUNDS = "4";
process.env.SIGNED_URL_TTL_SECONDS = "60";
process.env.STORAGE_PROVIDER = "cloudinary";
process.env.CLOUDINARY_UPLOAD_FOLDER = "vaultshare";
process.env.REDIS_KEY_PREFIX = "vaultshare:";
process.env.MAX_GLOBAL_ATTEMPTS_PER_FILE = "20";
process.env.MAX_ATTEMPTS_PER_IP = "5";
process.env.LOCKOUT_MS = "900000";

// These must exist for validateEnv() to pass
// Real values come from .env — the above just ensures the keys exist
// if .env wasn't loaded (e.g. CI environment)
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost/test";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test";

// Suppress console.log in tests — errors still show
if (process.env.NODE_ENV === "test") {
  global.console.log = jest.fn();
}
