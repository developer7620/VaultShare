"use strict";

// Load .env file before importing anything that reads process.env
require("dotenv").config();

// This import triggers fail-fast env validation — if vars are missing, exits here
const env = require("./config/env");
const { connectDB, disconnectDB } = require("./config/db");
const app = require("./app");

let server;

async function start() {
  // Connect to MongoDB before accepting traffic
  await connectDB();

  server = app.listen(env.port, () => {
    console.log(
      `[Server] VaultShare API running on port ${env.port} [${env.nodeEnv}]`,
    );
    console.log(`[Server] Health check → http://localhost:${env.port}/health`);
  });

  // Handle server-level errors (e.g., EADDRINUSE — port already in use)
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Server] Port ${env.port} is already in use`);
    } else {
      console.error("[Server] Unexpected server error:", err);
    }
    process.exit(1);
  });
}

/**
 * Graceful shutdown handler.
 *
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete
 * 3. Close DB connection
 * 4. Exit cleanly
 */
async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal} — initiating graceful shutdown`);

  // Stop accepting new requests
  server.close(async () => {
    console.log("[Server] HTTP server closed");

    // Close DB connection
    await disconnectDB();

    console.log("[Server] Shutdown complete");
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

// Handle container stop signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Catch truly unexpected errors — log and exit (don't try to recover)
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection:", reason);
  process.exit(1);
});

start();
