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
const fileRoutes = require("./routes/file.routes");
const adminRoutes = require("./routes/admin.routes");
const webhookRoutes = require("./routes/webhook.routes");

const app = express();
app.set("trust proxy", 1);

app.use(requestId);

app.use(
  helmet({
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

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID", "RateLimit-Limit", "RateLimit-Remaining"],
    credentials: false,
  }),
);

app.use("/api/", generalLimiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

if (process.env.NODE_ENV !== "test") {
  app.use(
    morgan("combined", {
      stream: { write: (message) => process.stdout.write(message) },
    }),
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────
app.use("/health", healthRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhooks", webhookRoutes);

// ─── 404 handler ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  next(
    new AppError(
      `Route ${req.method} ${req.path} not found`,
      404,
      "ROUTE_NOT_FOUND",
    ),
  );
});

// ─── Error handler (must be last) ──────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
