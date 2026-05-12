// backend/scripts/smoke-test-day3.js
// Run with: node scripts/smoke-test-day3.js

require("dotenv").config();
require("../src/config/env"); // trigger fail-fast validation

const mongoose = require("mongoose");
const env = require("../src/config/env");
const File = require("../src/models/File.model");
const storage = require("../src/storage");
const { hashIp } = require("../src/utils/hash");

async function run() {
  await mongoose.connect(env.mongodbUri);
  console.log("✅ DB connected\n");

  // Test 1: StorageProvider name
  console.log(`✅ Storage provider: ${storage.getName()}`);

  // Test 2: Upload signature generation
  const sig = await storage.generateUploadSignature({ maxBytes: 5_000_000 });
  console.log("✅ Upload signature generated:");
  console.log(`   - timestamp: ${sig.timestamp}`);
  console.log(`   - signature: ${sig.signature.substring(0, 16)}...`);
  console.log(`   - uploadUrl: ${sig.uploadUrl}\n`);

  // Test 3: File model creation
  const file = new File({
    storageKey: "vaultshare/test123",
    storageProvider: "cloudinary",
    originalName: "test-document.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_048_576,
    isPasswordProtected: false,
    maxDownloads: 5,
    downloadsRemaining: 5,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h from now
  });

  // Test 4: Virtuals
  console.log(`✅ isExpired virtual: ${file.isExpired}`);
  console.log(
    `✅ isDownloadLimitReached virtual: ${file.isDownloadLimitReached}`,
  );
  console.log(`✅ humanReadableSize virtual: ${file.humanReadableSize}`);

  // Test 5: canBeDownloaded()
  const { allowed, reason } = file.canBeDownloaded();
  console.log(`✅ canBeDownloaded: ${allowed} (reason: ${reason})\n`);

  // Test 6: toJSON strips passwordHash
  file.passwordHash = "should-be-stripped";
  const json = file.toJSON();
  console.log(
    `✅ passwordHash stripped from JSON: ${!("passwordHash" in json)}`,
  );
  console.log(`✅ downloads stripped from JSON: ${!("downloads" in json)}\n`);

  // Test 7: IP hashing
  const ipHash = hashIp("192.168.1.1");
  console.log(`✅ IP hash: ${ipHash.substring(0, 16)}...`);

  // Test 8: recordDownload instance method
  file.recordDownload(ipHash, "Mozilla/5.0 Test");
  console.log(`✅ downloadCount after record: ${file.downloadCount}`);
  console.log(`✅ downloads array length: ${file.downloads.length}\n`);

  // Test 9: Save to DB and retrieve
  await file.save();
  console.log(`✅ Saved to DB with _id: ${file._id}`);

  const retrieved = await File.findByIdActive(file._id);
  console.log(`✅ findByIdActive retrieved: ${retrieved.originalName}\n`);

  // Cleanup
  await File.deleteOne({ _id: file._id });
  console.log("✅ Test document cleaned up");

  await mongoose.disconnect();
  console.log("\n✅ All Day 3 smoke tests passed");
}

run().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
