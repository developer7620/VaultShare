"use strict";

const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const StorageProvider = require("./StorageProvider");
const env = require("../config/env");

class CloudinaryProvider extends StorageProvider {
  constructor() {
    super();
    this._folder = env.cloudinary.uploadFolder;
    this._apiKey = env.cloudinary.apiKey;
    this._apiSecret = env.cloudinary.apiSecret;
    this._cloudName = env.cloudinary.cloudName;
    this._configured = false;
  }

  _getClient() {
    if (!this._configured) {
      cloudinary.config({
        cloud_name: this._cloudName,
        api_key: this._apiKey,
        api_secret: this._apiSecret,
        secure: true,
      });
      this._configured = true;
    }
    return cloudinary;
  }

  getName() {
    return "cloudinary";
  }

  async generateUploadSignature(options = {}) {
    const timestamp = Math.round(Date.now() / 1000);

    // Only sign folder + timestamp — no type field needed for default upload type
    const paramsToSign = {
      folder: this._folder,
      timestamp,
    };

    const signature = this._generateSignature(paramsToSign);

    return {
      signature,
      timestamp,
      apiKey: this._apiKey,
      cloudName: this._cloudName,
      folder: this._folder,
      resourceType: "raw",
      uploadType: null, // ← null means don't send type field at all
      uploadUrl: `https://api.cloudinary.com/v1_1/${this._cloudName}/raw/upload`,
      maxBytes: options.maxBytes || 104_857_600,
    };
  }

  async generateSignedDeliveryUrl(storageKey, options = {}) {
    const { ttlSeconds = env.signedUrlTtlSeconds } = options;
    const client = this._getClient();

    const url = client.url(storageKey, {
      resource_type: "raw",
      type: "upload", // ← change from 'private' to 'upload'
      sign_url: true,
      expires_at: Math.round(Date.now() / 1000) + ttlSeconds,
    });

    return url;
  }

  async deleteFile(storageKey) {
    const client = this._getClient();

    // Try 'upload' type first (current default), fall back to 'private'
    // for files uploaded before the type change
    for (const type of ["upload", "private"]) {
      try {
        const result = await client.uploader.destroy(storageKey, {
          resource_type: "raw",
          type,
          invalidate: true,
        });

        if (result.result === "ok") {
          return; // Successfully deleted
        }

        if (result.result === "not found") {
          return; // Already gone — idempotent success
        }
      } catch (err) {
        // Try next type
        continue;
      }
    }

    // Both types failed — log but don't throw (cron will retry)
    console.warn(
      `[CloudinaryProvider] Could not delete ${storageKey} with any type`,
    );
  }

  async verifyResource(storageKey) {
    const client = this._getClient();
    try {
      const resource = await client.api.resource(storageKey, {
        resource_type: "raw",
        type: "private",
      });
      if (!resource.public_id.startsWith(this._folder + "/")) {
        throw new Error("Resource not in expected folder");
      }
      return resource;
    } catch (err) {
      if (err.error?.http_code === 404 || err.message?.includes("not found")) {
        return null;
      }
      throw err;
    }
  }

  _generateSignature(params) {
    const sortedKeys = Object.keys(params).sort();
    const canonical = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
    return crypto
      .createHash("sha256")
      .update(canonical + this._apiSecret)
      .digest("hex");
  }
}

module.exports = CloudinaryProvider;
