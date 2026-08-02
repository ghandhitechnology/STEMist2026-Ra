/**
 * Telemetry line icons — 1.5px stroke, functional only (DESIGN.md §1.8).
 * Sized by the `size` prop; colour always inherits `currentColor`.
 */

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false as const,
});

/** Chevron pointing right — collapses the panel toward the edge. */
export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/** Chevron pointing left — expands the panel from the rail. */
export function ChevronLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

/** Retry / reconnect. */
export function RetryIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 8a5 5 0 1 1-1.6-3.67" />
      <path d="M13 2.5V5.2h-2.7" />
    </svg>
  );
}

/** Delta caret — up (value rose toward the positive pole). */
export function CaretUpIcon({ size = 8, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={className}
    >
      <path d="M1.5 5.5 4 2.75 6.5 5.5" />
    </svg>
  );
}

/** Stacked rows — the diverging-bar reading of the trait axes. */
export function RowsIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 4h11M4.5 8h9M3.5 12h11" />
    </svg>
  );
}

/** Hexagon — the radar reading of the three trait axes. */
export function PolygonIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2.25 13 5.1v5.8L8 13.75 3 10.9V5.1Z" />
    </svg>
  );
}

/** Delta caret — down. */
export function CaretDownIcon({ size = 8, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={className}
    >
      <path d="M1.5 2.75 4 5.5 6.5 2.75" />
    </svg>
  );
}
