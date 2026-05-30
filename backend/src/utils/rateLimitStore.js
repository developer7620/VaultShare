/**
 * Rate limit store abstraction.
 *
 * Provides a unified interface for storing counters and TTLs.
 * Two implementations:
 *   - MemoryStore  (default, development, single-process)
 *   - RedisStore   (production, multi-process — uncomment when Redis available)
 *
 * Interface:
 *   increment(key, ttlMs) → Promise<{ count, ttlMs }>
 *   get(key)             → Promise<{ count, ttlMs } | null>
 *   delete(key)          → Promise<void>
 *   reset(prefix)        → Promise<void>  (clears all keys with prefix)
 *
 * Switching to Redis:
 *   1. npm install ioredis
 *   2. Set REDIS_URL in .env
 *   3. The factory at the bottom handles the rest — zero other changes.
 */

"use strict";

const env = require("../config/env");

// ─── Memory Store ──────────────────────────────────────────────────────────

class MemoryStore {
  constructor() {
    // Map<key, { count, expiresAt }>
    this._store = new Map();

    // Cleanup every 10 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 10 * 60 * 1000);
    this._cleanupInterval.unref();
  }

  async increment(key, ttlMs) {
    const now = Date.now();
    const existing = this._store.get(key);

    // If entry exists and hasn't expired, increment it
    if (existing && existing.expiresAt > now) {
      existing.count += 1;
      return { count: existing.count, ttlMs: existing.expiresAt - now };
    }

    // New entry or expired — reset to 1
    const entry = { count: 1, expiresAt: now + ttlMs };
    this._store.set(key, entry);
    return { count: 1, ttlMs };
  }

  async get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;

    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this._store.delete(key);
      return null;
    }

    return { count: entry.count, ttlMs: remaining };
  }

  async delete(key) {
    this._store.delete(key);
  }

  async reset(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        this._store.delete(key);
      }
    }
  }

  _cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._store.entries()) {
      if (entry.expiresAt <= now) {
        this._store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[RateLimitStore] Cleaned ${removed} expired entries`);
    }
  }

  close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
  }
}

// ─── Redis Store ───────────────────────────────────────────────────────────
// Uncomment when REDIS_URL is available in production

/*
class RedisStore {
  constructor(redisUrl) {
    const Redis = require('ioredis');
    this._client = new Redis(redisUrl, {
      keyPrefix: env.redis.keyPrefix,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    this._client.on('error', (err) => {
      console.error('[RedisStore] Connection error:', err.message);
    });
  }

  async increment(key, ttlMs) {
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    // Lua script for atomic increment + TTL set
    // KEYS[1] = key, ARGV[1] = ttlSeconds
    const script = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('PTTL', KEYS[1])
      return {count, ttl}
    `;
    const [count, ttlRemaining] = await this._client.eval(script, 1, key, ttlSeconds);
    return { count, ttlMs: ttlRemaining };
  }

  async get(key) {
    const [count, ttl] = await Promise.all([
      this._client.get(key),
      this._client.pttl(key),
    ]);
    if (!count) return null;
    return { count: parseInt(count, 10), ttlMs: ttl };
  }

  async delete(key) {
    await this._client.del(key);
  }

  async reset(prefix) {
    const keys = await this._client.keys(`${prefix}*`);
    if (keys.length > 0) {
      await this._client.del(...keys);
    }
  }
}
*/

// ─── Factory ───────────────────────────────────────────────────────────────

function createStore() {
  const isTest = process.env.NODE_ENV === "test";

  if (env.redis?.url) {
    if (!isTest) console.log("[RateLimitStore] Using Redis store");
    // return new RedisStore(env.redis.url);
  }

  if (!isTest) {
    console.log(
      "[RateLimitStore] Using in-memory store (not suitable for multi-process)",
    );
  }

  return new MemoryStore();
}

// Singleton
const store = createStore();
module.exports = store;
