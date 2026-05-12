/**
 * StorageProvider — abstract base class defining the storage interface.
 *
 * Any class that extends StorageProvider must implement all methods below.
 * Unimplemented methods throw at runtime, not silently fail.
 *
 * The interface has exactly 3 responsibilities:
 *   1. generateUploadSignature — authorise a client-side upload
 *   2. generateSignedDeliveryUrl — create a short-lived download URL
 *   3. deleteFile — remove a file from storage (called by cron job)
 *
 * It deliberately has NO upload() method — the client uploads directly.
 * The backend never handles file bytes.
 *
 * JSDoc types below give VS Code autocomplete on subclasses even without TS.
 */

"use strict";

class StorageProvider {
  /**
   * Generate the parameters a client needs to upload directly to storage.
   *
   * For Cloudinary: returns { signature, timestamp, apiKey, cloudName, folder }
   * For S3: returns { url, fields } (presigned POST)
   *
   * @param {Object} options
   * @param {string} options.folder     - Storage folder/prefix for the upload
   * @param {number} options.maxBytes   - Maximum allowed file size in bytes
   * @param {string[]} options.allowedFormats - Allowed MIME types or extensions
   * @returns {Promise<Object>} Provider-specific upload parameters
   */
  // eslint-disable-next-line no-unused-vars
  async generateUploadSignature(options) {
    throw new Error(
      `[StorageProvider] generateUploadSignature() must be implemented by ${this.constructor.name}`,
    );
  }

  /**
   * Generate a short-lived signed URL for downloading a file.
   *
   * The URL must be valid for exactly `ttlSeconds` seconds.
   * After expiry, the URL returns 401/403 from the storage provider.
   *
   * @param {string} storageKey   - The file's key in storage (public_id for Cloudinary, object key for S3)
   * @param {Object} options
   * @param {number} options.ttlSeconds     - How long the URL stays valid
   * @param {string} options.originalName   - Used to set Content-Disposition filename
   * @param {string} options.mimeType       - Used to set Content-Type
   * @returns {Promise<string>} Signed URL
   */
  // eslint-disable-next-line no-unused-vars
  async generateSignedDeliveryUrl(storageKey, options) {
    throw new Error(
      `[StorageProvider] generateSignedDeliveryUrl() must be implemented by ${this.constructor.name}`,
    );
  }

  /**
   * Permanently delete a file from storage.
   *
   * Must be idempotent — calling it on an already-deleted file should not throw.
   * This is important for cron job retry safety.
   *
   * @param {string} storageKey   - The file's key in storage
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deleteFile(storageKey) {
    throw new Error(
      `[StorageProvider] deleteFile() must be implemented by ${this.constructor.name}`,
    );
  }

  /**
   * Returns a string identifier for this provider.
   * Used in logs, the File document's storageProvider field, and error messages.
   *
   * @returns {string}
   */
  getName() {
    throw new Error(
      `[StorageProvider] getName() must be implemented by ${this.constructor.name}`,
    );
  }
}

module.exports = StorageProvider;
