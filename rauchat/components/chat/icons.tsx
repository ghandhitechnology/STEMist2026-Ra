/**
 * components/chat/icons.tsx
 *
 * Functional line icons only (DESIGN.md §1.8): 1.5px stroke, currentColor,
 * square 16px box by default. No decorative iconography, no emoji, no fills.
 */

import type { SVGProps } from "react";

export type IconProps = {
  size?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "className">;

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------- tools (DESIGN.md §4.6 order) ---------- */

export const IconWebSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.25" cy="7.25" r="4.75" />
    <path d="M2.5 7.25h9.5M7.25 2.5c1.2 1.35 1.85 3 1.85 4.75S8.45 10.65 7.25 12M7.25 2.5C6.05 3.85 5.4 5.5 5.4 7.25S6.05 10.65 7.25 12" />
    <path d="M10.9 10.9L14 14" />
  </Svg>
);

export const IconResearch = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="4" height="4" rx="1" />
    <rect x="10" y="10" width="4" height="4" rx="1" />
    <path d="M4 6v3.5A2.5 2.5 0 0 0 6.5 12H10" />
    <path d="M6 4h3.5A2.5 2.5 0 0 1 12 6.5V10" />
  </Svg>
);

export const IconPdf = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75z" />
    <path d="M9 1.75v4h4" />
    <path d="M5.75 9.5h4.5M5.75 11.75h3" />
  </Svg>
);

export const IconFileRead = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8.25v-2.5l-4-4H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5H7" />
    <path d="M9 1.75v4h4" />
    <path d="M14 11.5h-4.5M11.25 9.5 9.25 11.5l2 2" />
  </Svg>
);

export const IconFileWrite = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 7.5v-1.75l-4-4H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h3" />
    <path d="M9 1.75v4h4" />
    <path d="m13.4 9.1-3.6 3.6-.4 1.8 1.8-.4 3.6-3.6a.99.99 0 0 0-1.4-1.4z" />
  </Svg>
);

export const IconSkill = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
    <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
    <path d="M11.25 2.25v4M9.25 4.25h4" />
  </Svg>
);

export const IconDiagram = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M1.75 5.75h12.5" />
    <path d="M6 8.5 4.25 10.25 6 12" />
    <path d="m10 8.5 1.75 1.75L10 12" />
  </Svg>
);

/** Node-and-curve motif — svg_render tool card (inline vector output). */
export const IconSvg = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11.5c1.5-6.5 4.5-8.5 6-4.5s3 5.5 4.5 1" />
    <circle cx="3" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

/** Bookmark outline — memory_add tool card (distinct from IconFileWrite). */
export const IconMemory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 2.25h7a1 1 0 0 1 1 1v10.5l-4.5-3.1-4.5 3.1V3.25a1 1 0 0 1 1-1z" />
  </Svg>
);

/* ---------- chrome ---------- */

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 6 4 4 4-4" />
  </Svg>
);

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M4 9.5 8 13.5l4-4" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3M3.75 7.25 8 3l4.25 4.25" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.75" y="5.75" width="8" height="8" rx="1.25" />
    <path d="M10.25 3.5v-.25a1 1 0 0 0-1-1H3.25a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.25" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 8.5 3.25 3.25L13 5" />
  </Svg>
);

export const IconRegenerate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" />
    <path d="M13.75 2.5v3.25H10.5" />
  </Svg>
);

export const IconBranch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 4.75v6.5" />
    <circle cx="4.5" cy="3" r="1.6" />
    <circle cx="4.5" cy="13" r="1.6" />
    <circle cx="11.5" cy="3" r="1.6" />
    <path d="M11.5 4.75v1.5A2.5 2.5 0 0 1 9 8.75H4.5" />
  </Svg>
);

export const IconThumbUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 14h5.1a1.5 1.5 0 0 0 1.48-1.25l.75-4.25A1.25 1.25 0 0 0 11.6 7H9V4.25A1.75 1.75 0 0 0 7.25 2.5L5.5 7.25z" />
    <path d="M5.5 7.25H3.75A.75.75 0 0 0 3 8v5.25c0 .41.34.75.75.75H5.5z" />
  </Svg>
);

export const IconThumbDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2h5.1a1.5 1.5 0 0 1 1.48 1.25l.75 4.25A1.25 1.25 0 0 1 11.6 9H9v2.75A1.75 1.75 0 0 1 7.25 13.5L5.5 8.75z" />
    <path d="M5.5 8.75H3.75A.75.75 0 0 1 3 8V2.75c0-.41.34-.75.75-.75H5.5z" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.25" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="12.75" cy="8" r=".9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBrowser = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
    <path d="M2 5.75h12" />
    <circle cx="4" cy="4.25" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="5.75" cy="4.25" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconAttach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.75 7.5 8 12.25a3 3 0 0 1-4.25-4.25l5-5a2 2 0 0 1 2.83 2.83l-5 5a1 1 0 0 1-1.42-1.42L9.5 5.25" />
  </Svg>
);

export const IconShare = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10.5V2.5M5.25 5.25 8 2.5l2.75 2.75" />
    <path d="M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
  </Svg>
);

export const IconPanelRight = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
    <path d="M10 2.75v10.5" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5v7.5M5.25 7.5 8 10.25l2.75-2.75" />
    <path d="M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h4v4" />
    <path d="M12.75 3.25 7.5 8.5" />
    <path d="M12 9.75v2.75a1.25 1.25 0 0 1-1.25 1.25h-7A1.25 1.25 0 0 1 2.5 12.5v-7A1.25 1.25 0 0 1 3.75 4.25H6.5" />
  </Svg>
);

export const IconFullscreen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 2.75H3.75a1 1 0 0 0-1 1V6M10 2.75h2.25a1 1 0 0 1 1 1V6" />
    <path d="M6 13.25H3.75a1 1 0 0 1-1-1V10M10 13.25h2.25a1 1 0 0 0 1-1V10" />
  </Svg>
);

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 10.75v.01" />
  </Svg>
);
