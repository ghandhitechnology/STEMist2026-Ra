/**
 * Shared line-icon set — 1.5px stroke, functional only (DESIGN.md §1.8).
 * Owned by the sidebar/modals agent; imported by both components/sidebar/**
 * and components/modals/** (both within this agent's file ownership).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconPlus({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconSearch({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M13 13l-2.6-2.6" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M10 3L6 8l4 5" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 3l4 5-4 5" />
    </svg>
  );
}

export function IconX({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconPencil({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M10.5 2.5l3 3L5 14l-3.3.8L2.5 11.5 10.5 2.5Z" />
    </svg>
  );
}

export function IconTrash({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 4.5h10M6.3 4.5V3a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
    </svg>
  );
}

export function IconGear({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.4 3.6l-1.05 1.05M4.65 11.35l-1.05 1.05M12.4 12.4l-1.05-1.05M4.65 4.65 3.6 3.6" />
    </svg>
  );
}

export function IconFolder({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.9l1.3 1.6h5.4A1.2 1.2 0 0 1 14 5.8v6.4A1.2 1.2 0 0 1 12.8 13.4H3.2A1.2 1.2 0 0 1 2 12.2V4.2Z" />
    </svg>
  );
}

export function IconSkill({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8.8 1.6 3.4 8.6h3.1L6.2 14.4l5.4-7.2H8.6l0.2-5.6Z" />
    </svg>
  );
}

export function IconFile({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4.2 1.8h5l2.6 2.6v9a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z" />
      <path d="M9.2 1.8v2.6h2.6" />
    </svg>
  );
}

export function IconPanel({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6.2 2.5v11" />
    </svg>
  );
}

export function IconCheck({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3.2 8.4l3 3 6.6-6.8" />
    </svg>
  );
}

export function IconLoader({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 2.2v2.4M8 11.4v2.4M13.8 8h-2.4M4.6 8H2.2" opacity={0.9} />
    </svg>
  );
}
