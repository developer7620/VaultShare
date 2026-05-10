"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const requestId = require("./middleware/requestId");
const { generalLimiter } = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const healthRoutes = require("./routes/health.routes");
const AppError = require("./utils/AppError");

const app = express();

// ─── 1. Request ID (first — threads through all logs) ──────────────────────
app.use(requestId);

// ─── 2. Security headers ───────────────────────────────────────────────────
app.use(
  helmet({
    // Strict Content-Security-Policy — tightened per-route as needed
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://api.cloudinary.com"],
      },
    },
  }),
);

// CORS — in production, restrict to your actual frontend domain
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID", "RateLimit-Limit", "RateLimit-Remaining"],
    credentials: false, // VaultShare uses no session cookies — no need
  }),
);

// ─── 3. Rate limiting (before body parsing — cheap rejection) ──────────────
app.use("/api/", generalLimiter);

// ─── 4. Body parsing ───────────────────────────────────────────────────────
// Intentionally small limit — we never receive file data, only metadata
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ─── 5. HTTP request logging ───────────────────────────────────────────────
// 'combined' format includes IP, method, path, status, response time, user-agent
// In production: pipe to a log aggregator (CloudWatch, Datadog) via a custom stream
if (process.env.NODE_ENV !== "test") {
  app.use(
    morgan("combined", {
      // Add request ID to every log line for correlation
      stream: {
        write: (message) => process.stdout.write(message),
      },
    }),
  );
}

// ─── 6. API routes ─────────────────────────────────────────────────────────
app.use("/health", healthRoutes);

// Placeholder — file routes added Day 4
// app.use('/api/files', fileRoutes);

// ─── 7. 404 handler ────────────────────────────────────────────────────────
// Any request that reaches here didn't match a route
app.use((req, res, next) => {
  next(
    new AppError(
      `Route ${req.method} ${req.path} not found`,
      404,
      "ROUTE_NOT_FOUND",
    ),
  );
});

// ─── 8. Global error handler (must be last) ────────────────────────────────
app.use(errorHandler);

module.exports = app;
