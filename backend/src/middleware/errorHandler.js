/**
 * Centralised error handling middleware.
 *
 * Express identifies error middleware by the 4-argument signature (err, req, res, next).
 * This MUST be registered LAST in app.js — after all routes.
 *
 * Two categories of errors:
 * 1. Operational (AppError.isOperational = true) — expected failures like "file not found".
 *    Safe to send details to client.
 * 2. Programming errors — bugs, unexpected failures.
 *    Log full stack, send generic message to client (never leak internals).
 */

"use strict";

const env = require("../config/env");

/**
 * Formats Mongoose validation errors into our standard error shape.
 * Mongoose throws these when schema validation fails on save().
 */
function handleMongooseValidationError(err) {
  const messages = Object.values(err.errors).map((e) => e.message);
  return {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: messages.join(". "),
  };
}

/**
 * Handles MongoDB duplicate key errors (E11000).
 * Example: trying to insert a document with a duplicate unique-indexed field.
 */
function handleMongoDuplicateKeyError(err) {
  const field = Object.keys(err.keyPattern || {})[0] || "field";
  return {
    statusCode: 409,
    code: "DUPLICATE_KEY",
    message: `A record with this ${field} already exists.`,
  };
}

/**
 * Handles MongoDB CastError — usually an invalid ObjectId format.
 * Example: GET /files/not-a-valid-id
 */
function handleMongoCastError(err) {
  return {
    statusCode: 400,
    code: "INVALID_ID",
    message: `Invalid value for field: ${err.path}`,
  };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log every error with request context for debugging
  // In production, pipe this to your logging service (Datadog, CloudWatch, etc.)
  console.error({
    timestamp: new Date().toISOString(),
    requestId: req.id,
    method: req.method,
    path: req.path,
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: env.nodeEnv === "development" ? err.stack : undefined,
    },
  });

  // Mongoose-specific errors → normalise to our error shape
  if (err.name === "ValidationError") {
    const normalised = handleMongooseValidationError(err);
    return res.status(normalised.statusCode).json({
      success: false,
      error: normalised,
    });
  }

  if (err.code === 11000) {
    const normalised = handleMongoDuplicateKeyError(err);
    return res.status(normalised.statusCode).json({
      success: false,
      error: normalised,
    });
  }

  if (err.name === "CastError") {
    const normalised = handleMongoCastError(err);
    return res.status(normalised.statusCode).json({
      success: false,
      error: normalised,
    });
  }

  // Our own AppError instances — safe to expose to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      },
    });
  }

  // Unknown/programming error — never leak details
  // In production: alert your on-call engineer here
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong. Please try again later.",
      statusCode: 500,
    },
  });
}

module.exports = errorHandler;
