/**
 * Wraps async route handlers to automatically forward errors to Express's
 * next(err) error handling middleware.
 *
 * Without this, an unhandled promise rejection in a controller either:
 * - Hangs the request forever (Express <5)
 * - Crashes the process (Node.js unhandledRejection)
 *
 * Usage:
 *   router.get('/files/:id', asyncHandler(async (req, res) => {
 *     const file = await fileService.get(req.params.id);
 *     res.json(file);
 *   }));
 */

"use strict";

/**
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Express-compatible route handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
