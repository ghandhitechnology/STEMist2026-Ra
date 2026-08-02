type AuthPayload = {
  code?: unknown;
  error?: unknown;
};

const AUTH_MESSAGES: Record<string, string> = {
  AUTH_CHALLENGE_UNSUPPORTED:
    "This account requires an authentication step Rauchat does not support yet. Try Google or GitHub, or contact the administrator.",
  AUTH_CONTENT_TYPE_INVALID: "Rauchat sent an invalid authentication request.",
  AUTH_NOT_CONFIGURED:
    "Authentication is not configured correctly. Contact the administrator.",
  AUTH_ORIGIN_MISMATCH:
    "Sign-in was opened from an unexpected address. Reload Rauchat from its official URL and try again.",
  AUTH_PROVIDER_UNAVAILABLE:
    "The authentication service is temporarily unavailable. Try again.",
  EMAIL_ALREADY_REGISTERED:
    "An account with that email already exists. Sign in instead.",
  EMAIL_UNAVAILABLE:
    "WorkOS rejected this email even though no matching account exists. Try another email or review the WorkOS email restrictions.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  INVALID_EMAIL: "Enter a valid email address.",
  PASSWORD_RESET_INVALID: "That reset code is invalid or has expired.",
  PASSWORD_TOO_WEAK:
    "That password is too weak. Use at least 10 characters and avoid common words.",
  VERIFICATION_CODE_INVALID: "That code is incorrect or has expired.",
};

export function authMessage(data: unknown, fallback: string): string {
  const payload = (data ?? {}) as AuthPayload;
  const code = typeof payload.code === "string" ? payload.code : "";
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  return typeof payload.error === "string" && payload.error
    ? payload.error
    : fallback;
}
