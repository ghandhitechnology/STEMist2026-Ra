import { describe, expect, it } from "vitest";
import {
  TELEMETRY_DEFAULT_WIDTH,
  TELEMETRY_MIN_WIDTH,
  clampTelemetryWidth,
  telemetryMaxWidth,
} from "./telemetry-layout";

describe("telemetry panel sizing", () => {
  it("caps the panel at one third of a desktop viewport", () => {
    expect(telemetryMaxWidth(1440)).toBe(480);
    expect(clampTelemetryWidth(700, 1440)).toBe(480);
  });

  it("keeps the instrument usable on narrower viewports", () => {
    expect(telemetryMaxWidth(768)).toBe(TELEMETRY_MIN_WIDTH);
    expect(clampTelemetryWidth(100, 768)).toBe(TELEMETRY_MIN_WIDTH);
  });

  it("falls back safely for invalid persisted values", () => {
    expect(clampTelemetryWidth(Number.NaN, 1440)).toBe(
      TELEMETRY_DEFAULT_WIDTH,
    );
  });
});
