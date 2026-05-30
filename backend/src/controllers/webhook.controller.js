/**
 * Webhook controller — receives upload notifications from Cloudinary.
 *
 * Cloudinary sends a POST to your webhook URL when:
 *   - A file is uploaded (eager transformation complete)
 *   - A file is deleted
 *   - A moderation result is ready
 *
 * We use upload notifications to detect files that were uploaded
 * directly to Cloudinary (via our signed upload) but never registered
 * via /api/files/register. These become candidates for orphan cleanup.
 *
 * Webhook verification:
 *   Cloudinary signs every webhook with:
 *   HMAC-SHA1(body + timestamp, api_secret)
 *   The signature is in the X-Cld-Signature header.
 *   We verify before processing — unauthenticated webhooks are rejected.
 *
 * Local testing with ngrok:
 *   1. npm install -g ngrok
 *   2. ngrok http 3000
 *   3. Set webhook URL in Cloudinary dashboard to:
 *      https://your-ngrok-url.ngrok.io/api/webhooks/cloudinary
 */

"use strict";

const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const File = require("../models/File.model");
const deadLetterService = require("../services/deadLetter.service");
const env = require("../config/env");

// Grace period: don't flag a file as unregistered if it's too new
const REGISTRATION_GRACE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives Cloudinary upload/delete notifications.
 * Verifies signature, then processes the event.
 */
const handleCloudinaryWebhook = asyncHandler(async (req, res) => {
  // ── Step 1: Verify webhook signature ─────────────────────────────────
  const signature = req.headers["x-cld-signature"];
  const timestamp = req.headers["x-cld-timestamp"];

  if (!signature || !timestamp) {
    throw new AppError(
      "Missing webhook signature headers.",
      400,
      "WEBHOOK_UNSIGNED",
    );
  }

  const isValid = verifyWebhookSignature(req.body, timestamp, signature);

  if (!isValid) {
    // Log the attempt — could be a probe or misconfigured webhook
    console.warn("[Webhook] Invalid signature from", req.ip);
    throw new AppError(
      "Invalid webhook signature.",
      401,
      "WEBHOOK_SIGNATURE_INVALID",
    );
  }

  // ── Step 2: Parse the event ───────────────────────────────────────────
  const event = req.body;
  const notificationType = event.notification_type;

  console.log(
    `[Webhook] Received ${notificationType} for ${event.public_id || "unknown"}`,
  );

  // ── Step 3: Route to handler ──────────────────────────────────────────
  switch (notificationType) {
    case "upload":
      await handleUploadNotification(event);
      break;

    case "delete":
      await handleDeleteNotification(event);
      break;

    default:
      // Unknown event type — acknowledge receipt, do nothing
      console.log(`[Webhook] Unhandled notification type: ${notificationType}`);
  }

  // Always respond quickly — Cloudinary retries if it doesn't get a 200
  res.status(200).json({ received: true });
});

// ─── Event handlers ────────────────────────────────────────────────────────

/**
 * Handle upload notification.
 *
 * When Cloudinary tells us a file was uploaded, we check if it was
 * registered in MongoDB. If not, and it's old enough (past grace period),
 * it's an orphan — schedule for cleanup.
 *
 * Why wait for the grace period?
 * The upload completes before /register is called. A webhook might
 * arrive before the client has a chance to call /register. We give
 * it 30 minutes before flagging as orphaned.
 */
async function handleUploadNotification(event) {
  const publicId = event.public_id;
  const folder = env.cloudinary.uploadFolder;

  // Only process files in our folder
  if (!publicId || !publicId.startsWith(folder + "/")) {
    return;
  }

  // Check if this file is registered in MongoDB
  const file = await File.findOne({ storageKey: publicId }).lean();

  if (file) {
    // Registered — nothing to do
    console.log(`[Webhook] Upload confirmed registered: ${publicId}`);
    return;
  }

  // Not registered yet — check if within grace period
  const uploadTime = new Date(event.created_at || Date.now());
  const ageMs = Date.now() - uploadTime.getTime();

  if (ageMs < REGISTRATION_GRACE_MS) {
    console.log(
      `[Webhook] Unregistered upload within grace period: ${publicId} ` +
        `(${Math.round(ageMs / 1000)}s old)`,
    );
    // Could schedule a delayed check here — for simplicity, the hourly
    // orphan job will catch it if it's still unregistered
    return;
  }

  // Past grace period and unregistered — orphan
  console.warn(`[Webhook] Orphan detected via webhook: ${publicId}`);

  await deadLetterService.enqueue({
    storageKey: publicId,
    storageProvider: "cloudinary",
    reason: "orphan_cleanup",
    fileId: null,
    error: "File uploaded but never registered",
  });
}

/**
 * Handle delete notification.
 *
 * When Cloudinary tells us a file was deleted (e.g., via the Cloudinary
 * dashboard directly), we update the File document status to reflect
 * the storage is gone.
 */
async function handleDeleteNotification(event) {
  const publicId = event.public_id;
  if (!publicId) return;

  const file = await File.findOne({ storageKey: publicId });

  if (!file) {
    console.log(`[Webhook] Delete notification for unknown key: ${publicId}`);
    return;
  }

  // Clear the storageKey — storage is gone
  await File.updateOne({ _id: file._id }, { $set: { storageKey: null } });

  console.log(
    `[Webhook] Cleared storageKey for ${publicId} after delete notification`,
  );
}

// ─── Signature verification ────────────────────────────────────────────────

/**
 * Verify Cloudinary webhook signature.
 *
 * Cloudinary's spec:
 *   signature = SHA1(sorted_params_string + api_secret)
 *
 * For webhooks specifically:
 *   stringToSign = JSON.stringify(body) + timestamp
 *   expected = SHA1(stringToSign + api_secret)
 *
 * @param {Object} body       - Parsed request body
 * @param {string} timestamp  - X-Cld-Timestamp header value
 * @param {string} signature  - X-Cld-Signature header value
 * @returns {boolean}
 */
function verifyWebhookSignature(body, timestamp, signature) {
  try {
    const apiSecret = env.cloudinary.apiSecret;
    const bodyString = JSON.stringify(body);
    const stringToSign = bodyString + timestamp + apiSecret;

    const expected = crypto
      .createHash("sha1")
      .update(stringToSign)
      .digest("hex");

    // Constant-time comparison
    if (expected.length !== signature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch (err) {
    console.error("[Webhook] Signature verification error:", err.message);
    return false;
  }
}

module.exports = { handleCloudinaryWebhook };
