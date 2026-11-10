/**
 * lib/server/profile.ts — the user's personalization profile.
 *
 * Distinct from the workspace sandbox: profiles live outside
 * `<RAUCHAT_WORKSPACE>/users/<userId>/` at `<RAUCHAT_WORKSPACE>/profiles/`,
 * keyed by the same sanitized WorkOS user id, since they're account
 * metadata rather than sandboxed files. Consumed by app/api/profile/route.ts,
 * app/setup/page.tsx, and (cross-track) chat personalization / account
 * deletion.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { profileFile, profilesDir } from "./paths";

export { profilesDir };

export type Profile = {
  firstName: string;
  lastName: string;
  nickname: string;
  preferredLanguage: string;
  createdAt: number;
  updatedAt: number;
};

async function ensureProfilesDir(): Promise<void> {
  await mkdir(profilesDir(), { recursive: true });
}

export async function getProfile(userId: string): Promise<Profile | null> {
  try {
    const raw = await readFile(profileFile(userId), "utf8");
    const parsed = JSON.parse(raw) as Partial<Profile>;
    if (
      typeof parsed.firstName !== "string" ||
      typeof parsed.lastName !== "string" ||
      typeof parsed.nickname !== "string" ||
      typeof parsed.preferredLanguage !== "string"
    ) {
      return null;
    }
    return {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      nickname: parsed.nickname,
      preferredLanguage: parsed.preferredLanguage,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    // Missing or corrupt file both read as "no profile yet".
    return null;
  }
}

export async function saveProfile(
  userId: string,
  input: {
    firstName: string;
    lastName: string;
    nickname: string;
    preferredLanguage: string;
  }
): Promise<Profile> {
  await ensureProfilesDir();
  const existing = await getProfile(userId);
  const now = Date.now();
  const profile: Profile = {
    firstName: input.firstName,
    lastName: input.lastName,
    nickname: input.nickname,
    preferredLanguage: input.preferredLanguage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFile(profileFile(userId), JSON.stringify(profile, null, 2), "utf8");
  return profile;
}

export async function deleteProfile(userId: string): Promise<void> {
  try {
    await unlink(profileFile(userId));
  } catch {
    // Already gone — deleting a nonexistent profile is not an error.
  }
}
