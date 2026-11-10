/**
 * Development-only identity used for a trusted, single-user Mac Mini session.
 *
 * The second condition is intentional: setting the flag in a production build
 * can never bypass WorkOS. Start `next dev` with
 * RAUCHAT_LOCAL_FULL_ACCESS=true to opt into this mode for that process.
 */
export function isLocalFullAccessEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RAUCHAT_LOCAL_FULL_ACCESS === "true"
  );
}

export const LOCAL_FULL_ACCESS_USER = {
  id: "local-full-access",
  email: "local@mac-mini.invalid",
  firstName: "Local",
  lastName: "Operator",
  profilePictureUrl: null,
} as const;

export const LOCAL_FULL_ACCESS_PROFILE = {
  firstName: "Local",
  lastName: "Operator",
  nickname: "Operator",
  preferredLanguage: "English",
} as const;
