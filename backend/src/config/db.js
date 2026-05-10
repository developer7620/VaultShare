"use strict";

const mongoose = require("mongoose");
const env = require("./env");

// Mongoose 7+ no longer needs these options, but they're explicit for clarity
const MONGOOSE_OPTIONS = {
  // Disable autoIndex in production — manage indexes via scripts
  autoIndex: env.nodeEnv !== "production",
};

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    return;
  }

  try {
    const conn = await mongoose.connect(env.mongodbUri, MONGOOSE_OPTIONS);
    isConnected = true;

    console.log(`[DB] Connected → ${conn.connection.host}`);

    // Log disconnection events — important for detecting network issues
    mongoose.connection.on("disconnected", () => {
      console.warn("[DB] Disconnected from MongoDB");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("[DB] Reconnected to MongoDB");
      isConnected = true;
    });

    mongoose.connection.on("error", (err) => {
      console.error("[DB] Connection error:", err.message);
    });
  } catch (err) {
    console.error("[DB] Initial connection failed:", err.message);
    // Exit process — app cannot function without DB
    process.exit(1);
  }
}

/**
 * Graceful shutdown — close DB connection before process exits.
 * Called from server.js on SIGTERM/SIGINT.
 */
async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.connection.close();
  console.log("[DB] Connection closed gracefully");
}

/**
 * Returns the raw Mongoose connection — used by health check endpoint
 * to verify DB is actually reachable (not just that connect() was called).
 */
function getConnection() {
  return mongoose.connection;
}

module.exports = { connectDB, disconnectDB, getConnection };
