/**
 * Storage provider factory.
 *
 * This is the only import any other module should use:
 *   const storage = require('../storage');
 *
 * Returns a singleton instance of the configured provider.
 * The singleton matters: providers configure SDK clients in their constructor.
 * Instantiating them repeatedly would re-configure the SDK on every call.
 *
 * Adding a new provider:
 *   1. Create MyProvider.js extending StorageProvider
 *   2. Add a case to the switch below
 *   3. Set STORAGE_PROVIDER=myprovider in env
 *   Zero other files change.
 */

"use strict";

const env = require("../config/env");
const CloudinaryProvider = require("./CloudinaryProvider");
const S3Provider = require("./S3Provider");

const PROVIDERS = {
  cloudinary: CloudinaryProvider,
  s3: S3Provider,
};

function createStorageProvider() {
  const providerName = env.storageProvider.toLowerCase();
  const ProviderClass = PROVIDERS[providerName];

  if (!ProviderClass) {
    const available = Object.keys(PROVIDERS).join(", ");
    throw new Error(
      `[Storage] Unknown provider "${providerName}". ` +
        `Available: ${available}. ` +
        `Set STORAGE_PROVIDER in your .env file.`,
    );
  }

  const instance = new ProviderClass();

  console.log(`[Storage] Provider initialised: ${instance.getName()}`);

  return instance;
}

// Singleton — created once when this module is first required
const storageProvider = createStorageProvider();

module.exports = storageProvider;
