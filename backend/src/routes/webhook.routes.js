/**
 * Webhook routes.
 *
 * No authentication middleware — Cloudinary doesn't send an API key,
 * it signs the payload. Signature verification happens inside the controller.
 *
 * Rate limiting: generous — Cloudinary sends one webhook per event,
 * not per second. But we still protect against webhook flooding.
 *
 * Body parsing note: webhook signature verification requires the raw
 * body string. Express's express.json() is fine here because we
 * verify against JSON.stringify(req.body) which is deterministic
 * for Cloudinary's payload structure.
 */

"use strict";

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const {
  handleCloudinaryWebhook,
} = require("../controllers/webhook.controller");

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 webhooks per minute — generous for legitimate Cloudinary traffic
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Rate limit exceeded" });
  },
});

router.post("/cloudinary", webhookLimiter, handleCloudinaryWebhook);

module.exports = router;
