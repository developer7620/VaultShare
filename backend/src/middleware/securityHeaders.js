/**
 * Security header middleware factory.
 *
 * Returns helmet middleware configured for specific route contexts.
 * The global helmet in app.js is a baseline — these override per route.
 *
 * Why per-route CSP?
 * The upload route needs to connect to api.cloudinary.com.
 * The download route redirects to res.cloudinary.com.
 * Setting both globally is more permissive than needed for each route.
 *
 * Usage:
 *   router.post('/sign', securityHeaders.upload, controller.sign);
 *   router.post('/:id/download', securityHeaders.download, controller.download);
 */

"use strict";

const helmet = require("helmet");

const upload = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.cloudinary.com"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
});

const download = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Allow redirecting to Cloudinary for file delivery
      connectSrc: ["'self'", "https://res.cloudinary.com"],
      // Allow loading from Cloudinary for inline preview (images)
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
});

const api = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
    },
  },
});

module.exports = { upload, download, api };
