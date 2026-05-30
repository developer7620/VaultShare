"use strict";

const env = require("../config/env");
const CloudinaryProvider = require("./CloudinaryProvider");
const S3Provider = require("./S3Provider");

const PROVIDERS = {
  cloudinary: CloudinaryProvider,
  s3: S3Provider,
};

let _instance = null;

function getStorageProvider() {
  if (_instance) return _instance;

  const providerName = (env.storageProvider || "cloudinary").toLowerCase();
  const ProviderClass = PROVIDERS[providerName];

  if (!ProviderClass) {
    throw new Error(
      `[Storage] Unknown provider "${providerName}". ` +
        `Available: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }

  _instance = new ProviderClass();
  const isTest = process.env.NODE_ENV === "test";
  if (!isTest) {
    console.log(`[Storage] Provider initialised: ${_instance.getName()}`);
  }
  return _instance;
}

module.exports = new Proxy(
  {},
  {
    get(_, prop) {
      const provider = getStorageProvider();
      const value = provider[prop];
      return typeof value === "function" ? value.bind(provider) : value;
    },
  },
);
