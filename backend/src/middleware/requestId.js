/**
 * Attaches a unique ID to every request.
 *
 * Why: when you have concurrent requests and a shared log stream, you need
 * to correlate all log lines for a single request. The request ID threads
 * through every log entry for that request lifecycle.
 *
 * In production, check for X-Request-ID from a load balancer first — this
 * lets you trace a request from the load balancer through to your service.
 */

"use strict";

const { v4: uuidv4 } = require("uuid");

function requestId(req, res, next) {
  const id = req.headers["x-request-id"] || uuidv4();
  req.id = id;

  // Echo it back so clients can correlate their request with your logs
  res.setHeader("X-Request-ID", id);

  next();
}

module.exports = requestId;
