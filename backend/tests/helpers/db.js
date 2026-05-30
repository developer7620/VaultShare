/**
 * Shared MongoDB memory server setup.
 * Import this in every test file that needs DB access.
 *
 * Usage:
 *   const { setupDB } = require('../helpers/db');
 *   setupDB(); // call at top level — sets up beforeAll/afterAll/afterEach
 */

"use strict";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

function setupDB() {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    // Clear all collections between tests — guaranteed clean slate
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });
}

module.exports = { setupDB };
