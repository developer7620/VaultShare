/**
 * S3Provider — AWS S3 implementation of StorageProvider.
 *
 * STATUS: Stubbed. Methods throw NotImplementedError.
 * Full implementation on Day 14.
 *
 * When implemented, this will use:
 *   - @aws-sdk/s3-request-presigner for presigned upload URLs (PUT, not POST)
 *   - @aws-sdk/client-s3 for deletion
 *   - CloudFront signed URLs for delivery (faster than S3 presigned, CDN-cached)
 *
 * The S3 upload flow differs slightly from Cloudinary:
 *   - Cloudinary uses POST with form fields + signature
 *   - S3 uses PUT with a presigned URL (simpler for clients, no form fields)
 * Both are transparent to controllers — they call generateUploadSignature()
 * and get back whatever the provider needs. The client adapts to the response shape.
 *
 * Migration path (Day 14):
 *   1. Set STORAGE_PROVIDER=s3 in environment
 *   2. New uploads go to S3
 *   3. Existing files (storageProvider: 'cloudinary' in DB) still served via Cloudinary
 *   4. Background job migrates old files over time (optional)
 */

"use strict";

const StorageProvider = require("./StorageProvider");

class S3Provider extends StorageProvider {
  constructor() {
    super();
    // Day 14: initialise AWS SDK clients here
    // this._s3Client = new S3Client({ region: env.aws.region });
    // this._bucket = env.aws.bucket;
  }

  getName() {
    return "s3";
  }

  async generateUploadSignature(options) {
    // Day 14 implementation:
    // const command = new PutObjectCommand({ Bucket: this._bucket, Key: key });
    // const url = await getSignedUrl(this._s3Client, command, { expiresIn: 3600 });
    // return { uploadUrl: url, method: 'PUT', key };
    throw new Error("[S3Provider] Not implemented — coming Day 14");
  }

  async generateSignedDeliveryUrl(storageKey, options) {
    // Day 14 implementation:
    // Use CloudFront signed URL for CDN delivery
    // Fall back to S3 presigned GET URL if no CloudFront
    throw new Error("[S3Provider] Not implemented — coming Day 14");
  }

  async deleteFile(storageKey) {
    // Day 14 implementation:
    // const command = new DeleteObjectCommand({ Bucket: this._bucket, Key: storageKey });
    // await this._s3Client.send(command);
    throw new Error("[S3Provider] Not implemented — coming Day 14");
  }
}

module.exports = S3Provider;
