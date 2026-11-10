export type AuthErrorCode =
  | "AUTH_CHALLENGE_UNSUPPORTED"
  | "AUTH_CONTENT_TYPE_INVALID"
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_ORIGIN_MISMATCH"
  | "AUTH_PROVIDER_UNAVAILABLE"
  | "EMAIL_ALREADY_REGISTERED"
  | "EMAIL_UNAVAILABLE"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "INVALID_EMAIL"
  | "INVALID_REQUEST"
  | "PASSWORD_RESET_INVALID"
  | "PASSWORD_TOO_WEAK"
  | "SIGN_UP_FAILED"
  | "VERIFICATION_CODE_INVALID";

type WorkOSErrorShape = {
  code?: unknown;
  errors?: unknown;
  message?: unknown;
  name?: unknown;
  pendingAuthenticationToken?: unknown;
  requestID?: unknown;
  requestId?: unknown;
  status?: unknown;
  rawData?: {
    code?: unknown;
    error?: unknown;
    errors?: unknown;
    reason?: unknown;
    pending_authentication_token?: unknown;
  };
};

export type WorkOSErrorDetails = {
  code: string;
  issueCodes: string[];
  name: string;
  pendingAuthenticationToken: string | null;
  requestId: string | null;
  status: number | null;
};

const UNSUPPORTED_CHALLENGES = new Set([
  "mfa_enrollment",
  "mfa_challenge",
  "mfa_verification",
  "organization_selection_required",
  "radar_email_challenge",
  "radar_sms_challenge",
  "sso_required",
]);

const PROVIDER_CONFIGURATION_ERRORS = new Set([
  "api_key_invalid",
  "client_not_found",
  "invalid_api_key",
  "invalid_client",
  "unauthorized_client",
]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function issueCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const code = stringValue((issue as { code?: unknown }).code);
    return code ? [code] : [];
  });
}

export function getWorkOSErrorDetails(err: unknown): WorkOSErrorDetails {
  const candidate = (err ?? {}) as WorkOSErrorShape;
  const raw = candidate.rawData ?? {};
  return {
    code:
      stringValue(candidate.code) ||
      stringValue(raw.code) ||
      stringValue(raw.error) ||
      stringValue(raw.reason),
    issueCodes: issueCodes(candidate.errors ?? raw.errors),
    name: stringValue(candidate.name) || "Error",
    pendingAuthenticationToken:
      stringValue(candidate.pendingAuthenticationToken) ||
      stringValue(raw.pending_authentication_token) ||
      null,
    requestId:
      stringValue(candidate.requestID) || stringValue(candidate.requestId) || null,
    status:
      typeof candidate.status === "number" && Number.isFinite(candidate.status)
        ? candidate.status
        : null,
  };
}

export function isEmailVerificationRequired(
  details: WorkOSErrorDetails
): boolean {
  return (
    details.code === "email_verification_required" &&
    Boolean(details.pendingAuthenticationToken)
  );
}

export function isUnsupportedAuthChallenge(
  details: WorkOSErrorDetails
): boolean {
  return UNSUPPORTED_CHALLENGES.has(details.code);
}

export function hasWorkOSIssue(
  details: WorkOSErrorDetails,
  ...codes: string[]
): boolean {
  return codes.some(
    (code) => details.code === code || details.issueCodes.includes(code)
  );
}

export function isWorkOSUnavailable(details: WorkOSErrorDetails): boolean {
  return (
    PROVIDER_CONFIGURATION_ERRORS.has(details.code) ||
    details.status === null ||
    details.status === 429 ||
    details.status >= 500 ||
    details.status === 401 ||
    details.status === 403
  );
}

export function authErrorResponse(
  code: AuthErrorCode,
  error: string,
  status: number
): Response {
  return Response.json({ error, code }, { status });
}

/** Log only operational metadata. Error messages and request values may hold PII. */
export function logAuthEvent(
  event: string,
  options: {
    details?: WorkOSErrorDetails;
    reason?: string;
    route?: string;
  } = {}
): void {
  const details = options.details;
  console.error(
    JSON.stringify({
      component: "auth",
      event,
      route: options.route,
      reason: options.reason,
      workosCode: details?.code || undefined,
      workosIssueCodes:
        details?.issueCodes.length ? details.issueCodes : undefined,
      workosErrorName: details?.name || undefined,
      workosStatus: details?.status ?? undefined,
      workosRequestId: details?.requestId ?? undefined,
    })
  );
}

export function authConfigurationReason(error: unknown): string {
  return error instanceof Error && error.name === "AuthConfigurationError"
    ? error.message
    : error instanceof Error
      ? error.name
      : "unknown";
}

export function authConfigurationResponse(
  route: string,
  error: unknown
): Response {
  logAuthEvent("configuration_error", {
    route,
    reason: authConfigurationReason(error),
  });
  return authErrorResponse(
    "AUTH_NOT_CONFIGURED",
    "Authentication is not configured correctly.",
    500
  );
}
