import { describe, expect, it, vi } from "vitest";
import {
  getWorkOSErrorDetails,
  hasWorkOSIssue,
  isEmailVerificationRequired,
  isUnsupportedAuthChallenge,
  isWorkOSUnavailable,
  logAuthEvent,
} from "./auth-errors";

describe("WorkOS error normalization", () => {
  it("reads SDK and raw authentication fields", () => {
    const details = getWorkOSErrorDetails({
      name: "AuthenticationException",
      status: 400,
      requestID: "request_123",
      rawData: {
        code: "email_verification_required",
        pending_authentication_token: "pending_123",
      },
    });

    expect(details).toEqual({
      code: "email_verification_required",
      issueCodes: [],
      name: "AuthenticationException",
      pendingAuthenticationToken: "pending_123",
      requestId: "request_123",
      status: 400,
    });
    expect(isEmailVerificationRequired(details)).toBe(true);
  });

  it("normalizes nested WorkOS validation issue codes", () => {
    const details = getWorkOSErrorDetails({
      code: "user_creation_error",
      errors: [
        { code: "email_already_exists", message: "redacted" },
        { code: "password_too_weak", message: "redacted" },
      ],
      status: 400,
    });

    expect(details.issueCodes).toEqual([
      "email_already_exists",
      "password_too_weak",
    ]);
    expect(hasWorkOSIssue(details, "email_already_exists")).toBe(true);
  });

  it.each([
    "mfa_enrollment",
    "mfa_challenge",
    "organization_selection_required",
    "radar_email_challenge",
    "radar_sms_challenge",
    "sso_required",
  ])("recognizes unsupported challenge %s", (code) => {
    expect(isUnsupportedAuthChallenge(getWorkOSErrorDetails({ code }))).toBe(
      true
    );
  });

  it("separates ordinary 400 responses from provider failures", () => {
    expect(isWorkOSUnavailable(getWorkOSErrorDetails({ status: 400 }))).toBe(
      false
    );
    expect(isWorkOSUnavailable(getWorkOSErrorDetails({ status: 503 }))).toBe(
      true
    );
    expect(
      isWorkOSUnavailable(
        getWorkOSErrorDetails({ code: "invalid_client", status: 400 })
      )
    ).toBe(true);
    expect(isWorkOSUnavailable(getWorkOSErrorDetails(new Error("network")))).toBe(
      true
    );
  });

  it("never logs provider messages, tokens, or user data", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const details = getWorkOSErrorDetails({
      code: "email_verification_required",
      message: "person@example.com secret-message",
      pendingAuthenticationToken: "pending_secret",
      requestID: "request_safe",
      status: 400,
    });

    logAuthEvent("test", { details, route: "sign-in" });

    const serialized = String(consoleError.mock.calls[0]?.[0]);
    expect(serialized).toContain("request_safe");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("secret-message");
    expect(serialized).not.toContain("pending_secret");
  });
});
