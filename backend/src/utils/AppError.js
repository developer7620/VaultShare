/**
 * Application-level error with HTTP status code and machine-readable error code.
 *
 * Engineering decision: separating AppError (expected, operational errors like
 * "file not found") from unexpected errors (bugs, DB failures) lets the error
 * handler respond differently:
 *   - AppError → send structured JSON to client
 *   - Unknown error → log full stack, send generic 500
 *
 * This pattern is used by Stripe, GitHub's API, and most well-designed REST APIs.
 */

"use strict";

class AppError extends Error {
  /**
   * @param {string} message   - Human-readable message (shown to client)
   * @param {number} statusCode - HTTP status code
   * @param {string} code       - Machine-readable error code (used by clients)
   */
  constructor(message, statusCode, code) {
    super(message);

    this.statusCode = statusCode;
    this.code = code || "INTERNAL_ERROR";
    this.isOperational = true; // flag to distinguish from programming errors

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

// Predefined factory methods for common errors — keeps controllers clean
// Usage: throw AppError.notFound('File has expired')
AppError.notFound = (message = "Resource not found") =>
  new AppError(message, 404, "NOT_FOUND");

AppError.unauthorized = (message = "Unauthorized") =>
  new AppError(message, 401, "UNAUTHORIZED");

AppError.forbidden = (message = "Forbidden") =>
  new AppError(message, 403, "FORBIDDEN");

AppError.badRequest = (message = "Bad request", code = "BAD_REQUEST") =>
  new AppError(message, 400, code);

AppError.conflict = (message = "Conflict") =>
  new AppError(message, 409, "CONFLICT");

AppError.tooManyRequests = (message = "Too many requests") =>
  new AppError(message, 429, "RATE_LIMITED");

AppError.serviceUnavailable = (message = "Service temporarily unavailable") =>
  new AppError(message, 503, "SERVICE_UNAVAILABLE");

module.exports = AppError;
