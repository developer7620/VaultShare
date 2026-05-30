/**
 * S3Provider — AWS S3 implementation of StorageProvider.
 *
 * Upload flow (differs from Cloudinary):
 *   1. Backend generates a presigned PUT URL for a specific S3 key
 *   2. Client PUTs the file directly to that URL (Content-Type header required)
 *   3. Client calls /register with the S3 key
 *
 * Delivery flow:
 *   - Without CloudFront: S3 presigned GET URL (valid for ttlSeconds)
 *   - With CloudFront:    CloudFront signed URL (faster, CDN-cached)
 *     CloudFront signing requires a key pair provisioned in AWS console.
 *     The stub below documents the implementation path.
 *
 * Key naming convention:
 *   uploads/{uuid}/{originalName}
 *   The UUID prevents filename collisions. The originalName is preserved
 *   for Content-Disposition on download.
 *
 * IAM policy required for the access key:
 *   {
 *     "Effect": "Allow",
 *     "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
 *     "Resource": "arn:aws:s3:::vaultshare-files/*"
 *   }
 *
 * Bucket policy:
 *   - Block all public access: ON
 *   - No public bucket policy
 *   All access is via presigned URLs — bucket is never publicly accessible.
 */

"use strict";

const { randomUUID } = require("crypto");
const {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const StorageProvider = require("./StorageProvider");
const env = require("../config/env");

class S3Provider extends StorageProvider {
  constructor() {
    super();

    if (!env.aws.accessKeyId || !env.aws.secretAccessKey || !env.aws.bucket) {
      throw new Error(
        "[S3Provider] Missing required AWS config. " +
          "Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET.",
      );
    }

    this._client = new S3Client({
      region: env.aws.region,
      credentials: {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
    });

    this._bucket = env.aws.bucket;
    this._uploadUrlTtl = env.aws.uploadUrlTtlSeconds;
    this._cloudfrontDomain = env.aws.cloudfrontDomain;
  }

  getName() {
    return "s3";
  }

  /**
   * Generate a presigned PUT URL for direct client upload to S3.
   *
   * S3 presigned PUT differs from Cloudinary's signed POST:
   *   - Method is PUT (not POST)
   *   - Body is the raw file bytes (not multipart form)
   *   - Content-Type header must match what was signed
   *   - No form fields — just the URL + headers
   *
   * The client must:
   *   1. PUT the file to uploadUrl
   *   2. Set Content-Type header to the mimeType
   *   3. Send raw bytes in the body (not FormData)
   *
   * @param {Object} options
   * @param {string} options.originalName
   * @param {string} options.mimeType
   * @param {number} options.maxBytes
   * @returns {Promise<Object>}
   */
  async generateUploadSignature(options = {}) {
    const { originalName = "upload", mimeType = "application/octet-stream" } =
      options;

    // Generate a unique key for this upload
    // Format: uploads/{uuid}/{originalName}
    // The UUID prevents collisions; the original name is human-readable
    const uuid = randomUUID();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `uploads/${uuid}/${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: this._bucket,
      Key: key,
      ContentType: mimeType,
      // Server-side encryption — always encrypt at rest
      ServerSideEncryption: "AES256",
    });

    const uploadUrl = await getSignedUrl(this._client, command, {
      expiresIn: this._uploadUrlTtl,
    });

    return {
      // The S3 key — client sends this to /register as storageKey
      storageKey: key,
      // Client PUTs directly to this URL
      uploadUrl,
      // HTTP method for the upload
      method: "PUT",
      // Client must set this header on the PUT request
      contentType: mimeType,
      // Informational
      bucket: this._bucket,
      region: env.aws.region,
      expiresIn: this._uploadUrlTtl,
    };
  }

  /**
   * Generate a presigned GET URL (or CloudFront signed URL) for delivery.
   *
   * Two paths:
   *   1. CloudFront domain configured → CloudFront signed URL
   *      Faster (CDN-cached), but requires CloudFront key pair setup.
   *   2. No CloudFront → S3 presigned GET URL
   *      Slower (direct S3), but works with zero extra config.
   *
   * @param {string} storageKey - S3 object key
   * @param {Object} options
   * @param {number} options.ttlSeconds
   * @param {string} options.originalName - For Content-Disposition header
   * @returns {Promise<string>} Signed URL
   */
  async generateSignedDeliveryUrl(storageKey, options = {}) {
    const { ttlSeconds = env.signedUrlTtlSeconds, originalName = "download" } =
      options;

    if (this._cloudfrontDomain) {
      return this._generateCloudFrontUrl(storageKey, ttlSeconds, originalName);
    }

    return this._generateS3PresignedUrl(storageKey, ttlSeconds, originalName);
  }

  /**
   * Delete an object from S3.
   * Idempotent — S3 returns 204 even if the object doesn't exist.
   *
   * @param {string} storageKey - S3 object key
   */
  async deleteFile(storageKey) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this._bucket,
        Key: storageKey,
      });

      await this._client.send(command);
      // S3 DeleteObject is always successful (returns 204 even for missing keys)
    } catch (err) {
      throw new Error(
        `[S3Provider] Failed to delete ${storageKey}: ${err.message}`,
      );
    }
  }

  /**
   * Verify a file exists in S3 (used in register flow).
   * Uses HeadObject — fetches metadata only, no data transfer.
   *
   * @param {string} storageKey
   * @returns {Promise<Object|null>} Metadata or null if not found
   */
  async verifyResource(storageKey) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this._bucket,
        Key: storageKey,
      });

      const result = await this._client.send(command);

      return {
        storageKey,
        sizeBytes: result.ContentLength,
        mimeType: result.ContentType,
        lastModified: result.LastModified,
      };
    } catch (err) {
      // S3 returns 404 for missing objects
      if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") {
        return null;
      }
      throw err;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Generate a standard S3 presigned GET URL.
   * Valid for ttlSeconds. No CDN caching.
   */
  async _generateS3PresignedUrl(storageKey, ttlSeconds, originalName) {
    const command = new GetObjectCommand({
      Bucket: this._bucket,
      Key: storageKey,
      // Force browser to download instead of preview
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(originalName)}"`,
    });

    return getSignedUrl(this._client, command, { expiresIn: ttlSeconds });
  }

  /**
   * Generate a CloudFront signed URL.
   *
   * Requires:
   *   - A CloudFront distribution fronting your S3 bucket
   *   - A CloudFront key pair (created in AWS console → Security Credentials)
   *   - AWS_CLOUDFRONT_DOMAIN set to your distribution domain
   *   - AWS_CLOUDFRONT_KEY_PAIR_ID and AWS_CLOUDFRONT_PRIVATE_KEY in env
   *
   * CloudFront signed URLs are:
   *   - Faster than S3 presigned (served from edge nodes)
   *   - Cached (repeated downloads of the same file hit CDN, not S3)
   *   - More secure (signature is in query params, not path)
   *
   * Implementation uses @aws-sdk/cloudfront-signer (install separately).
   * Stubbed here — uncomment when CloudFront key pair is provisioned.
   */
  _generateCloudFrontUrl(storageKey, ttlSeconds, originalName) {
    /*
    const { getSignedUrl: getCFSignedUrl } = require('@aws-sdk/cloudfront-signer');

    const url = `https://${this._cloudfrontDomain}/${storageKey}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    return getCFSignedUrl({
      url,
      keyPairId: process.env.AWS_CLOUDFRONT_KEY_PAIR_ID,
      privateKey: process.env.AWS_CLOUDFRONT_PRIVATE_KEY,
      dateLessThan: expiresAt.toISOString(),
    });
    */

    // Fallback to S3 presigned while CloudFront isn't configured
    console.warn(
      "[S3Provider] CloudFront domain set but key pair not configured. Falling back to S3 presigned URL.",
    );
    return this._generateS3PresignedUrl(storageKey, ttlSeconds, originalName);
  }
}

module.exports = S3Provider;
