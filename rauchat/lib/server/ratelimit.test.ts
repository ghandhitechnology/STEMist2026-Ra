import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WORKSPACE_BASE_ROOT is resolved from the environment at module load, so
// each test gets a fresh temp workspace via resetModules + dynamic import.
let workspace: string;

async function loadLimiter() {
  vi.resetModules();
  vi.stubEnv("RAUCHAT_WORKSPACE", workspace);
  return await import("./ratelimit");
}

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "rauchat-ratelimit-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});

describe("consumeRateLimit", () => {
  it("allows requests under both limits", async () => {
    const { consumeRateLimit } = await loadLimiter();
    const now = new Date("2026-08-03T10:00:00Z");
    expect(await consumeRateLimit("user_a", "chat", now)).toEqual({ ok: true });
  });

  it("refuses once the burst window is spent, then recovers next minute", async () => {
    vi.stubEnv("RAUCHAT_CHAT_BURST_LIMIT", "2");
    const { consumeRateLimit } = await loadLimiter();
    const now = new Date("2026-08-03T10:00:10Z");
    await consumeRateLimit("user_a", "chat", now);
    await consumeRateLimit("user_a", "chat", now);
    const refused = await consumeRateLimit("user_a", "chat", now);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/give it a minute/i);

    const nextMinute = new Date("2026-08-03T10:01:10Z");
    expect(await consumeRateLimit("user_a", "chat", nextMinute)).toEqual({
      ok: true,
    });
  });

  it("refuses once the daily budget is spent, then resets next day", async () => {
    vi.stubEnv("RAUCHAT_CHAT_DAILY_LIMIT", "3");
    vi.stubEnv("RAUCHAT_CHAT_BURST_LIMIT", "2");
    const { consumeRateLimit } = await loadLimiter();
    // Spread across minutes so only the daily limit can trip.
    for (const minute of ["10:00", "10:01", "10:02"]) {
      const r = await consumeRateLimit(
        "user_a",
        "chat",
        new Date(`2026-08-03T${minute}:00Z`)
      );
      expect(r.ok).toBe(true);
    }
    const refused = await consumeRateLimit(
      "user_a",
      "chat",
      new Date("2026-08-03T10:03:00Z")
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/daily message limit/i);

    expect(
      await consumeRateLimit("user_a", "chat", new Date("2026-08-04T00:01:00Z"))
    ).toEqual({ ok: true });
  });

  it("tracks buckets and users independently", async () => {
    vi.stubEnv("RAUCHAT_RESEARCH_DAILY_LIMIT", "1");
    const { consumeRateLimit } = await loadLimiter();
    const now = new Date("2026-08-03T10:00:00Z");
    expect(await consumeRateLimit("user_a", "research", now)).toEqual({
      ok: true,
    });
    const refused = await consumeRateLimit(
      "user_a",
      "research",
      new Date("2026-08-03T10:01:00Z")
    );
    expect(refused.ok).toBe(false);
    // Same user, other bucket — and another user entirely — are unaffected.
    expect(await consumeRateLimit("user_a", "chat", now)).toEqual({ ok: true });
    expect(await consumeRateLimit("user_b", "research", now)).toEqual({
      ok: true,
    });
  });
});
