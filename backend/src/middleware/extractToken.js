/**
 * extractToken middleware
 *
 * Parses the upload token from the Authorization header.
 * Sets req.uploadToken to the token string, or null if absent.
 *
 * Expected format: Authorization: Bearer <token>
 *
 * Does NOT enforce token presence — that's the controller's job.
 * This middleware just makes the token available on req.
 *
 * Why a separate middleware instead of reading req.headers in the controller?
 * Single responsibility. The controller shouldn't know about header formats.
 * If you switch from Bearer tokens to a custom header (X-Upload-Token),
 * you change one file, not every controller.
 */

"use strict";

function extractToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";

  if (authHeader.startsWith("Bearer ")) {
    req.uploadToken = authHeader.slice(7).trim(); // Remove "Bearer " prefix
  } else {
    req.uploadToken = null;
  }

  next();
}

module.exports = extractToken;
