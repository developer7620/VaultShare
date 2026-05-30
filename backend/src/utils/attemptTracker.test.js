/**
 * AttemptTracker tests — verifies brute-force protection logic.
 *
 * These tests use the real MemoryStore — no mocking needed since
 * the store has no external dependencies in development mode.
 */

"use strict";

// Reset module registry between tests to get fresh store state
beforeEach(() => {
  jest.resetModules();
});

const FILE_ID = "test-file-123";
const IP = "192.168.1.1";
const UA = "TestBrowser/1.0";
const LANG = "en-US";

async function getTracker() {
  return require("../../src/utils/attemptTracker");
}

describe("attemptTracker — per-IP lockout", () => {
  test("not locked on first request", async () => {
    const tracker = await getTracker();
    const status = await tracker.isLocked(FILE_ID, IP, UA, LANG);
    expect(status.locked).toBe(false);
  });

  test("not locked after fewer than MAX_PER_IP failures", async () => {
    const tracker = await getTracker();

    // Record 4 failures (MAX_PER_IP - 1)
    for (let i = 0; i < 4; i++) {
      await tracker.recordFailure(FILE_ID, IP, UA, LANG);
    }

    const status = await tracker.isLocked(FILE_ID, IP, UA, LANG);
    expect(status.locked).toBe(false);
  });

  test("locked after MAX_PER_IP failures", async () => {
    const tracker = await getTracker();
    const { MAX_PER_IP } = tracker;

    for (let i = 0; i < MAX_PER_IP; i++) {
      await tracker.recordFailure(FILE_ID, IP, UA, LANG);
    }

    const status = await tracker.isLocked(FILE_ID, IP, UA, LANG);
    expect(status.locked).toBe(true);
    expect(status.reason).toBe("IP_LOCKOUT");
  });

  test("attemptsRemainingIp counts down correctly", async () => {
    const tracker = await getTracker();
    const { MAX_PER_IP } = tracker;

    const result = await tracker.recordFailure(FILE_ID, IP, UA, LANG);
    expect(result.attemptsRemainingIp).toBe(MAX_PER_IP - 1);

    const result2 = await tracker.recordFailure(FILE_ID, IP, UA, LANG);
    expect(result2.attemptsRemainingIp).toBe(MAX_PER_IP - 2);
  });

  test("resetClientAttempts clears lockout", async () => {
    const tracker = await getTracker();
    const { MAX_PER_IP } = tracker;

    for (let i = 0; i < MAX_PER_IP; i++) {
      await tracker.recordFailure(FILE_ID, IP, UA, LANG);
    }

    // Confirm locked
    expect((await tracker.isLocked(FILE_ID, IP, UA, LANG)).locked).toBe(true);

    // Reset
    await tracker.resetClientAttempts(FILE_ID, IP, UA, LANG);

    // Confirm unlocked
    expect((await tracker.isLocked(FILE_ID, IP, UA, LANG)).locked).toBe(false);
  });
});

describe("attemptTracker — global lockout", () => {
  test("global lockout fires after MAX_GLOBAL failures", async () => {
    const tracker = await getTracker();
    const { MAX_GLOBAL } = tracker;

    // Simulate MAX_GLOBAL different IPs each making 1 attempt
    for (let i = 0; i < MAX_GLOBAL; i++) {
      await tracker.recordFailure(FILE_ID, `10.0.0.${i}`, `Bot-${i}`, LANG);
    }

    // Any IP should now be globally locked
    const status = await tracker.isLocked(
      FILE_ID,
      "99.99.99.99",
      "NewBot",
      LANG,
    );
    expect(status.locked).toBe(true);
    expect(status.reason).toBe("GLOBAL_LOCKOUT");
  });

  test("global lockout checked before per-IP", async () => {
    const tracker = await getTracker();
    const { MAX_GLOBAL } = tracker;

    // Fill global counter
    for (let i = 0; i < MAX_GLOBAL; i++) {
      await tracker.recordFailure(FILE_ID, `10.0.${i}.1`, `Agent-${i}`, LANG);
    }

    // A brand new IP with zero attempts should still be globally locked
    const status = await tracker.isLocked(
      FILE_ID,
      "1.2.3.4",
      "FreshClient",
      LANG,
    );
    expect(status.locked).toBe(true);
    expect(status.reason).toBe("GLOBAL_LOCKOUT");
  });

  test("different files have independent counters", async () => {
    const tracker = await getTracker();
    const { MAX_GLOBAL } = tracker;

    // Lock file A
    for (let i = 0; i < MAX_GLOBAL; i++) {
      await tracker.recordFailure("file-A", `10.0.0.${i}`, UA, LANG);
    }

    // File B should not be affected
    const status = await tracker.isLocked("file-B", IP, UA, LANG);
    expect(status.locked).toBe(false);
  });
});

describe("attemptTracker — fingerprinting", () => {
  test("different IPs get different fingerprints", async () => {
    const tracker = await getTracker();
    const fp1 = tracker.buildFingerprint("1.1.1.1", UA, LANG);
    const fp2 = tracker.buildFingerprint("2.2.2.2", UA, LANG);
    expect(fp1).not.toBe(fp2);
  });

  test("same IP + same UA = same fingerprint (deterministic)", async () => {
    const tracker = await getTracker();
    const fp1 = tracker.buildFingerprint(IP, UA, LANG);
    const fp2 = tracker.buildFingerprint(IP, UA, LANG);
    expect(fp1).toBe(fp2);
  });

  test("same IP but different UA = different fingerprint", async () => {
    const tracker = await getTracker();
    const fp1 = tracker.buildFingerprint(IP, "Chrome/100", LANG);
    const fp2 = tracker.buildFingerprint(IP, "Firefox/99", LANG);
    expect(fp1).not.toBe(fp2);
  });
});
