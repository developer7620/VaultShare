"use strict";

module.exports = async function () {
  // dotenv must be loaded before requiring any src module
  require("dotenv").config();

  try {
    const store = require("../src/utils/rateLimitStore");
    if (store.close) store.close();
  } catch (e) {
    // ignore
  }
};
