/**
 * Health check routes.
 *
 * Two endpoints by design:
 *
 * GET /health        — "liveness" check. Is the process alive?
 *                      Load balancers use this. Fast, no DB call.
 *
 * GET /health/ready  — "readiness" check. Can the app serve traffic?
 *                      Checks DB connectivity. Kubernetes uses this.
 *                      If DB is unreachable, returns 503 and the pod
 *                      is removed from the load balancer rotation.
 *
 * This distinction matters in production: a pod can be "live" (process running)
 * but not "ready" (DB connection lost). Kubernetes handles each differently.
 */

"use strict";

const router = require("express").Router();
const mongoose = require("mongoose");
const asyncHandler = require("../utils/asyncHandler");

// Liveness — just confirms the process is running
router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    requestId: req.id,
  });
});

// Readiness — checks DB connectivity
router.get(
  "/ready",
  asyncHandler(async (req, res) => {
    // Mongoose readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    const dbState = mongoose.connection.readyState;
    const dbReady = dbState === 1;

    if (!dbReady) {
      return res.status(503).json({
        success: false,
        status: "not_ready",
        checks: {
          database: {
            status: "unreachable",
            readyState: dbState,
          },
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Do a lightweight DB ping to confirm actual connectivity
    await mongoose.connection.db.admin().ping();

    res.status(200).json({
      success: true,
      status: "ready",
      checks: {
        database: {
          status: "connected",
          host: mongoose.connection.host,
        },
      },
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }),
);

module.exports = router;
