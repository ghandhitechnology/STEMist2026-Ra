/**
 * lib/server/ratelimit.ts — per-user budgets for the model-backed routes.
 *
 * Rauchat is publicly sign-up-able and every chat/research turn spends real
 * OpenRouter credit, so each user gets a daily allowance plus a short burst
 * window against scripted abuse. Counters live at
 * `<RAUCHAT_WORKSPACE>/usage/<userId>.json` — filesystem state like every
 * other per-user store, so limits survive restarts and deploys.
 *
 * The read-modify-write is not atomic: two overlapping turns can lose an
 * increment. That slack only ever favors the user by a request or two, which
 * is fine for a spend guard — correctness here is "bounded", not "exact".
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeUserId, WORKSPACE_BASE_ROOT } from "./paths";

export type RateBucket = "chat" | "research";

type BucketLimits = { perDay: number; perMinute: number };

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Overridable per deployment without a code change. */
export function limitsFor(bucket: RateBucket): BucketLimits {
  if (bucket === "research") {
    return {
      perDay: envInt("RAUCHAT_RESEARCH_DAILY_LIMIT", 30),
      perMinute: envInt("RAUCHAT_RESEARCH_BURST_LIMIT", 4),
    };
  }
  return {
    perDay: envInt("RAUCHAT_CHAT_DAILY_LIMIT", 300),
    perMinute: envInt("RAUCHAT_CHAT_BURST_LIMIT", 12),
  };
}

type UsageFile = {
  /** UTC day the daily counters belong to, YYYY-MM-DD. */
  day: string;
  counts: Partial<Record<RateBucket, number>>;
  /** UTC minute the burst counters belong to, YYYY-MM-DDTHH:MM. */
  minute: string;
  minuteCounts: Partial<Record<RateBucket, number>>;
};

function usageFileFor(userId: string): string {
  return path.join(
    WORKSPACE_BASE_ROOT,
    "usage",
    `${sanitizeUserId(userId)}.json`
  );
}

async function readUsage(file: string): Promise<UsageFile | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as UsageFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export type RateDecision =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Spends one unit from the user's bucket, or refuses with a message meant to
 * be shown verbatim in the chat UI. `now` is injectable for tests.
 */
export async function consumeRateLimit(
  userId: string,
  bucket: RateBucket,
  now: Date = new Date()
): Promise<RateDecision> {
  const limits = limitsFor(bucket);
  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16);
  const file = usageFileFor(userId);

  const stored = await readUsage(file);
  const usage: UsageFile = {
    day,
    counts: stored && stored.day === day ? stored.counts ?? {} : {},
    minute,
    minuteCounts:
      stored && stored.minute === minute ? stored.minuteCounts ?? {} : {},
  };

  const dayCount = usage.counts[bucket] ?? 0;
  const minuteCount = usage.minuteCounts[bucket] ?? 0;

  if (dayCount >= limits.perDay) {
    return {
      ok: false,
      message:
        bucket === "research"
          ? `Daily research limit reached (${limits.perDay} runs). It resets at midnight UTC.`
          : `Daily message limit reached (${limits.perDay} turns). It resets at midnight UTC.`,
    };
  }
  if (minuteCount >= limits.perMinute) {
    return {
      ok: false,
      message: "You're going a little fast — give it a minute and try again.",
    };
  }

  usage.counts[bucket] = dayCount + 1;
  usage.minuteCounts[bucket] = minuteCount + 1;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(usage), "utf8");
  return { ok: true };
}
