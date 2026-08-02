export const TELEMETRY_DEFAULT_WIDTH = 320;
export const TELEMETRY_MIN_WIDTH = 288;

/** The expanded instrument can occupy roughly one third of the viewport. */
export function telemetryMaxWidth(viewportWidth: number): number {
  const safeViewport =
    Number.isFinite(viewportWidth) && viewportWidth > 0
      ? viewportWidth
      : TELEMETRY_DEFAULT_WIDTH * 3;
  return Math.max(TELEMETRY_MIN_WIDTH, Math.floor(safeViewport / 3));
}

export function clampTelemetryWidth(
  width: number,
  viewportWidth: number,
): number {
  const safeWidth = Number.isFinite(width) ? width : TELEMETRY_DEFAULT_WIDTH;
  return Math.round(
    Math.min(
      telemetryMaxWidth(viewportWidth),
      Math.max(TELEMETRY_MIN_WIDTH, safeWidth),
    ),
  );
}
