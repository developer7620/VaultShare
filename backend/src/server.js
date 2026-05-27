"use strict";

require("dotenv").config();

const env = require("./config/env");
const { connectDB, disconnectDB } = require("./config/db");
const app = require("./app");
const { startExpiryJob } = require("./jobs/expiry.job");

let server;
let expiryJob; // keep reference for graceful shutdown

async function start() {
  await connectDB();

  // Start the expiry cron job after DB is connected
  // runImmediately: true — sweep on startup to catch files that expired
  // during any server downtime window
  expiryJob = startExpiryJob({ runImmediately: true });

  server = app.listen(env.port, () => {
    console.log(
      `[Server] VaultShare API running on port ${env.port} [${env.nodeEnv}]`,
    );
    console.log(`[Server] Health check → http://localhost:${env.port}/health`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Server] Port ${env.port} is already in use`);
    } else {
      console.error("[Server] Unexpected server error:", err);
    }
    process.exit(1);
  });
}

async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal} — initiating graceful shutdown`);

  // Stop the cron job first — no new sweeps during shutdown
  if (expiryJob) {
    expiryJob.stop();
    console.log("[Server] Expiry job stopped");
  }

  server.close(async () => {
    console.log("[Server] HTTP server closed");
    await disconnectDB();
    console.log("[Server] Shutdown complete");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection:", reason);
  process.exit(1);
});

start();
