/**
 * app/api/profile/route.ts
 *   GET -> { profile: Profile | null, user: { id, email, firstName, lastName,
 *            profilePictureUrl } }  — the WorkOS identity plus the local
 *            personalization profile (lib/server/profile.ts). Used by
 *            app/setup/page.tsx to decide whether to show onboarding.
 *   PUT -> { profile: Profile }     — validates and saves the personalization
 *            profile, and best-effort mirrors the name back onto the WorkOS
 *            user record.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { getProfile, saveProfile } from "@/lib/server/profile";
import { getUserId, unauthorized } from "@/lib/server/auth";
import {
  isLocalFullAccessEnabled,
  LOCAL_FULL_ACCESS_PROFILE,
  LOCAL_FULL_ACCESS_USER,
} from "@/lib/local-access";

export const runtime = "nodejs";

export async function GET() {
  let user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePictureUrl: string | null;
  };

  if (isLocalFullAccessEnabled()) {
    user = LOCAL_FULL_ACCESS_USER;
  } else {
    const auth = await withAuth();
    if (!auth.user) return unauthorized();
    user = auth.user;
  }

  let profile = await getProfile(user.id);
  if (!profile && isLocalFullAccessEnabled()) {
    profile = await saveProfile(user.id, LOCAL_FULL_ACCESS_PROFILE);
  }
  return NextResponse.json({
    profile,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureUrl: user.profilePictureUrl,
    },
  });
}

const UpdateProfileSchema = z.object({
  firstName: z.string().min(1, "firstName must not be empty").max(120),
  lastName: z.string().min(1, "lastName must not be empty").max(120),
  nickname: z.string().min(1, "nickname must not be empty").max(32),
  preferredLanguage: z.string().min(1, "preferredLanguage must not be empty").max(40),
});

export async function PUT(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const profile = await saveProfile(userId, parsed.data);

  // Best-effort: keep the WorkOS user record's name in sync. Never fails the
  // request — the local profile is the source of truth for personalization.
  if (!isLocalFullAccessEnabled()) {
    try {
      await getWorkOS().userManagement.updateUser({
        userId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
      });
    } catch {
      // Non-fatal.
    }
  }

  return NextResponse.json({ profile });
}
