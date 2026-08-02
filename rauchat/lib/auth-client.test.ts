import { describe, expect, it } from "vitest";
import { authMessage } from "./auth-client";

describe("authMessage", () => {
  it("maps stable server codes to branded copy", () => {
    expect(authMessage({ code: "AUTH_ORIGIN_MISMATCH" }, "fallback")).toContain(
      "official URL"
    );
  });

  it("uses a safe server message for an unknown code", () => {
    expect(authMessage({ code: "NEW_CODE", error: "Try later." }, "fallback")).toBe(
      "Try later."
    );
  });

  it("distinguishes unavailable emails from existing accounts", () => {
    expect(authMessage({ code: "EMAIL_UNAVAILABLE" }, "fallback")).toContain(
      "no matching account exists"
    );
  });

  it("falls back for malformed payloads", () => {
    expect(authMessage(null, "fallback")).toBe("fallback");
  });
});
