# Rauchat — Design Specification v1.0

Status: **normative**. Engineers implement this exactly. Any value not listed here is a bug, not a choice.
Token prefix: `--rau-`. Theme: single dark theme only (no light mode in v1).

---

## 1. Principles

**1.1 Black is the substrate, not a style.**
The base canvas is `#000000`. Every surface above it is a *measurably* lighter neutral. Depth is expressed by a 1px border plus a ~6–10 luminance-point step, never by shadow, blur, or glow. There are no drop shadows anywhere in the product except the two overlay classes explicitly permitted in §4.14.

**1.2 One accent, spent carefully.**
`--rau-accent` is **Rau Amber `#E8A33D`**. It appears in at most **three places per viewport**. It means one of exactly two things: *this is the active/focused thing*, or *this is a live telemetry magnitude*. It is never decorative, never a background fill larger than 4px tall, never a gradient stop.

**1.3 Data is the ornament.**
The Model Telemetry panel is the only place in the UI allowed to be visually dense. Its density is earned by information, not decoration. Bars, ticks, and numerals carry the visual interest that a lesser product would get from gradients.

**1.4 Quiet by default, precise on contact.**
Resting state is low-contrast and calm: tertiary text, subtle borders, no fills. Hover and focus resolve elements into full contrast. The interface "wakes up" under the cursor rather than shouting at rest.

**1.5 Sharp geometry.**
Maximum border radius in the product is **8px**, and that is reserved for the composer shell and modal surfaces. Everything else is 2–6px. There are no pills, no circular avatars over 24px, no bubble tails, no capsule buttons. Right angles read as engineering.

**1.6 Reading is the primary task.**
The transcript column is typeset like a document: 15px/26px, 68ch measure, generous vertical rhythm. Chrome may be dense; prose may not.

**1.7 Absence must look intentional.**
The Gemma 4 12B evaluator weights are not loaded. The default telemetry state is therefore *awaiting substrate* — and it must read as a deliberately designed dormant instrument panel (dimmed axis scaffolding, em-dash values, a calm status chip), never as an error, a skeleton, or a spinner.

**1.8 Prohibited, absolutely.**
No purple→blue gradients. No gradient text. No `backdrop-filter` blur / glassmorphism. No `box-shadow` used as glow (no colored shadows, no `0 0 Npx accent`). No emoji anywhere in UI chrome (emoji in user/model *content* renders normally). No neumorphism. No rounded-everything. No bouncy/elastic easings. No animated gradient borders. No decorative iconography — icons are 1.5px-stroke line icons, functional only.

---

## 2. Tokens

Paste-ready. Declare on `:root`.

### 2.1 Color — background layers

```css
:root {
  /* Canvas & surfaces — L0 is the true black substrate */
  --rau-bg-l0:            #000000; /* app canvas, transcript scroll area */
  --rau-bg-l1:            #060607; /* sidebar, telemetry panel */
  --rau-bg-l2:            #0B0B0D; /* cards, composer shell, user message block */
  --rau-bg-l3:            #101013; /* raised: popovers, dropdown menus, tooltips */
  --rau-bg-l4:            #16161A; /* modal surface, top-most overlay */
  --rau-bg-inset:         #050506; /* code blocks, input wells, telemetry bar tracks */

  /* Interaction fills — always alpha white so they compose on any layer */
  --rau-fill-hover:       rgba(255,255,255,0.038);
  --rau-fill-active:      rgba(255,255,255,0.068);
  --rau-fill-selected:    rgba(255,255,255,0.055);
  --rau-fill-selected-hover: rgba(255,255,255,0.082);
  --rau-fill-disabled:    rgba(255,255,255,0.020);

  /* Scrim */
  --rau-scrim:            rgba(0,0,0,0.72);
}
```

### 2.2 Color — borders

```css
:root {
  --rau-border-faint:     #131316; /* internal dividers inside a card */
  --rau-border-subtle:    #1C1C20; /* default container border */
  --rau-border-default:   #26262B; /* inputs, buttons, interactive containers */
  --rau-border-strong:    #34343B; /* hover on interactive containers */
  --rau-border-loud:      #4A4A53; /* dragging, resize handles, active dividers */
  --rau-border-accent:    #E8A33D;
  --rau-border-danger:    #C4383D;
}
```

### 2.3 Color — text tiers

```css
:root {
  --rau-text-primary:     #EDEDEF; /* prose, headings, active labels */
  --rau-text-secondary:   #A3A3AB; /* supporting copy, inactive nav labels */
  --rau-text-tertiary:    #6D6D76; /* metadata, timestamps, axis pole labels */
  --rau-text-quaternary:  #4A4A52; /* dormant values, disabled scaffolding */
  --rau-text-disabled:    #3A3A41;
  --rau-text-on-accent:   #140D02; /* only for the single accent-filled button */
  --rau-text-link:        #EDEDEF; /* links are underlined, not colored */
  --rau-text-link-hover:  #FFFFFF;
}
```

Contrast record (vs `--rau-bg-l0` `#000`): primary 15.6:1, secondary 7.4:1, tertiary 3.4:1 (permitted for non-essential metadata ≥12px only), quaternary 1.9:1 (dormant/decorative scaffolding only — never carries meaning alone).

### 2.4 Color — accent

```css
:root {
  --rau-accent:           #E8A33D;
  --rau-accent-hover:     #F2B457;
  --rau-accent-press:     #C9862B;
  --rau-accent-muted:     #8A6224; /* accent text at low emphasis */
  --rau-accent-surface:   rgba(232,163,61,0.10); /* max-size 4px tall fill or 1px rule */
  --rau-accent-surface-strong: rgba(232,163,61,0.18);
  --rau-accent-track:     rgba(232,163,61,0.14);
}
```

### 2.5 Color — semantic states

```css
:root {
  --rau-success:          #3E9E6B;
  --rau-success-surface:  rgba(62,158,107,0.10);
  --rau-danger:           #DC4A50;
  --rau-danger-hover:     #E76066;
  --rau-danger-surface:   rgba(220,74,80,0.10);
  --rau-warning:          #D4923A; /* deliberately accent-family; see note */
  --rau-warning-surface:  rgba(212,146,58,0.10);
  --rau-neutral-status:   #6D6D76;
}
```

> **Warning/accent collision is intentional.** Amber is the product's attention hue; a second orange would be noise. Warning is therefore distinguished from accent by **icon + border + label**, never by hue alone. Warning is never used inside the telemetry panel (where amber already means magnitude).

### 2.6 Color — telemetry

```css
:root {
  --rau-tel-axis-line:    #26262B; /* the horizontal track for each axis */
  --rau-tel-center-tick:  #4A4A52; /* the 0.0 centre tick, 1px x 12px */
  --rau-tel-grid:         #131316; /* ±0.5 gridlines, 1px dotted */
  --rau-tel-pos:          #E8A33D; /* magnitude toward the FIRST-named pole */
  --rau-tel-neg:          #9A9AA4; /* magnitude toward the SECOND-named pole */
  --rau-tel-pos-dim:      rgba(232,163,61,0.28); /* stale (>1 turn old) */
  --rau-tel-neg-dim:      rgba(154,154,164,0.28);
  --rau-tel-dormant:      #232328; /* bar rendered when no data exists */
  --rau-tel-spark:        #6D6D76;
  --rau-tel-spark-head:   #E8A33D;

  --rau-status-live:      #3E9E6B;
  --rau-status-connecting:#E8A33D;
  --rau-status-dormant:   #5A5A63;
  --rau-status-error:     #DC4A50;
}
```

Hue encodes **direction only**; length encodes **magnitude**. Never introduce a third hue into a bar.

### 2.7 Typography

```css
:root {
  --rau-font-sans: "Inter var", "Inter", -apple-system, BlinkMacSystemFont,
                   "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --rau-font-mono: "Berkeley Mono", "JetBrains Mono", ui-monospace,
                   SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /* size / line-height / weight / tracking */
  --rau-fs-micro:   11px;  --rau-lh-micro:   16px;  /* uppercase section labels */
  --rau-fs-mini:    12px;  --rau-lh-mini:    16px;  /* telemetry values, badges */
  --rau-fs-xs:      13px;  --rau-lh-xs:      18px;  /* sidebar items, metadata */
  --rau-fs-sm:      14px;  --rau-lh-sm:      20px;  /* UI default, buttons, inputs */
  --rau-fs-base:    15px;  --rau-lh-base:    26px;  /* transcript prose */
  --rau-fs-lg:      17px;  --rau-lh-lg:      26px;  /* h3 in prose */
  --rau-fs-xl:      20px;  --rau-lh-xl:      28px;  /* h2 in prose, modal title */
  --rau-fs-2xl:     24px;  --rau-lh-2xl:     32px;  /* h1 in prose, empty-state head */

  --rau-fw-regular:  400;
  --rau-fw-medium:   500;
  --rau-fw-semibold: 590; /* variable axis; fall back to 600 for static Inter */

  --rau-ls-tight:   -0.022em; /* ≥20px headings */
  --rau-ls-snug:    -0.012em; /* 14–17px */
  --rau-ls-normal:   0em;     /* 15px prose */
  --rau-ls-wide:     0.04em;  /* 12px badges */
  --rau-ls-caps:     0.085em; /* 11px uppercase labels */
  --rau-ls-mono:    -0.005em;
}
```

Font features (global): `font-feature-settings: "cv05" 1, "ss03" 1, "calt" 1;` and `font-variant-numeric: tabular-nums;` on every numeric readout, telemetry value, timestamp, and token counter. Prose uses proportional figures.

Rendering: `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;`

### 2.8 Spacing

4px base grid. Only these values may be used.

```css
:root {
  --rau-space-0: 0px;
  --rau-space-1: 2px;
  --rau-space-2: 4px;
  --rau-space-3: 6px;
  --rau-space-4: 8px;
  --rau-space-5: 12px;
  --rau-space-6: 16px;
  --rau-space-7: 20px;
  --rau-space-8: 24px;
  --rau-space-9: 32px;
  --rau-space-10: 40px;
  --rau-space-11: 48px;
  --rau-space-12: 64px;
  --rau-space-13: 96px;
}
```

### 2.9 Radii

```css
:root {
  --rau-radius-xs: 2px;  /* badges, tags, telemetry bar caps, checkbox */
  --rau-radius-sm: 3px;  /* buttons, sidebar items, tool toggles, inputs */
  --rau-radius-md: 5px;  /* cards, tool event cards, user message block */
  --rau-radius-lg: 6px;  /* code blocks, popovers, menus */
  --rau-radius-xl: 8px;  /* composer shell, modal surface — MAXIMUM */
  --rau-radius-full: 9999px; /* ONLY: status dot, scrollbar thumb */
}
```

### 2.10 Borders, focus, elevation

```css
:root {
  --rau-hairline: 1px; /* all borders are 1px; use 0.5px never */
  --rau-focus-ring: 0 0 0 1px var(--rau-bg-l0), 0 0 0 2px var(--rau-accent);
  --rau-focus-ring-inset: inset 0 0 0 1px var(--rau-accent);
  /* The only two permitted shadows in the product: */
  --rau-elev-popover: 0 4px 16px -4px rgba(0,0,0,0.80), 0 1px 2px rgba(0,0,0,0.9);
  --rau-elev-modal:   0 16px 48px -12px rgba(0,0,0,0.88), 0 2px 6px rgba(0,0,0,0.9);
}
```

Both permitted shadows are pure black — no colored shadow exists in this product.

### 2.11 Motion tokens

```css
:root {
  --rau-dur-instant: 90ms;   /* fills: hover/active background */
  --rau-dur-fast:    130ms;  /* borders, text color, icon color, small transforms */
  --rau-dur-base:    170ms;  /* popovers, tooltips, card enter, toggles */
  --rau-dur-slow:    200ms;  /* panel collapse/expand, sidebar collapse */
  --rau-dur-telemetry: 240ms;/* telemetry bar length interpolation ONLY */

  --rau-ease-standard: cubic-bezier(0.20, 0, 0, 1);   /* default, decel */
  --rau-ease-exit:     cubic-bezier(0.40, 0, 1, 1);   /* leaving the screen */
  --rau-ease-inout:    cubic-bezier(0.45, 0, 0.20, 1);/* panel width, layout */
  --rau-ease-linear:   linear;                        /* progress, marquees */
}
```

No easing with overshoot exists in this product.

### 2.12 Layout dimensions

```css
:root {
  --rau-sidebar-w:            264px;
  --rau-sidebar-w-collapsed:  56px;
  --rau-telemetry-w:          320px;
  --rau-telemetry-w-rail:     44px;  /* collapsed vertical rail */
  --rau-measure:              720px; /* transcript column max-width */
  --rau-measure-wide:         860px; /* "wide mode" user preference */
  --rau-topbar-h:             48px;
  --rau-composer-min-h:       52px;
  --rau-composer-max-h:       240px;
  --rau-row-h:                32px;  /* sidebar/menu row height */
  --rau-row-h-lg:             36px;  /* primary rows, composer buttons */
  --rau-icon:                 16px;  /* default icon box */
  --rau-icon-sm:              14px;
  --rau-z-panel: 10; --rau-z-sticky: 20; --rau-z-popover: 40;
  --rau-z-modal: 60; --rau-z-toast: 80;
}
```

### 2.13 Scrollbars

Applies globally. Firefox: `scrollbar-width: thin; scrollbar-color: #2A2A30 transparent;`

```css
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: #232328;
  border: 3px solid transparent;      /* inset via border trick → 4px visible thumb */
  background-clip: padding-box;
  border-radius: var(--rau-radius-full);
  transition: background-color var(--rau-dur-fast) var(--rau-ease-standard);
}
*::-webkit-scrollbar-thumb:hover   { background: #34343B; background-clip: padding-box; }
*::-webkit-scrollbar-thumb:active  { background: #45454E; background-clip: padding-box; }
*::-webkit-scrollbar-corner { background: transparent; }
```

Scrollbars are always overlay-styled and never reserve layout space (`scrollbar-gutter: stable` only on the transcript scroller, to prevent measure jitter when content grows past the fold). Horizontal scrollbars are permitted only inside code blocks and tables.

---

## 3. Layout

### 3.1 App shell

Three columns in a CSS grid, full viewport height, no page-level scrolling.

```
┌──────────────┬───────────────────────────────────┬──────────────────┐
│  SIDEBAR     │            CHAT COLUMN            │  MODEL TELEMETRY │
│  264px       │              1fr                  │      320px       │
│  bg-l1       │             bg-l0                 │      bg-l1       │
└──────────────┴───────────────────────────────────┴──────────────────┘
```

`grid-template-columns: var(--rau-sidebar-w) minmax(0,1fr) var(--rau-telemetry-w);`

Column separators are `1px solid var(--rau-border-subtle)` applied as the right border of the sidebar and the left border of the telemetry panel. No gaps, no rounded panel corners, no floating cards — panels are flush to the viewport edge.

Both side panels are resizable by an invisible hit-area at the divider: sidebar 220–360px, telemetry 288px–approximately one third of the viewport. On hover the divider's visible 1px becomes `--rau-border-strong` after 200ms delay; while dragging it becomes `--rau-border-loud` with `cursor: col-resize`. Widths persist to localStorage, and telemetry plots reflow with the resized panel.

### 3.2 Breakpoints

| Width | Behavior |
|---|---|
| ≥1440px | All three columns. Measure 720px. |
| 1180–1439px | All three columns; transcript measure clamps to available space. |
| 1024–1179px | Telemetry collapses to the 44px rail by default (user can expand → it overlays as a right drawer with `--rau-elev-popover` and a scrim-free edge). |
| 768–1023px | Sidebar collapses to 56px icon rail. Telemetry rail only. |
| <768px | Single column. Sidebar and telemetry become full-height drawers over `--rau-scrim`, opened from a 48px top bar. Composer is sticky to the bottom with `env(safe-area-inset-bottom)`. |

### 3.3 Sidebar (264px)

Vertical stack, `bg: var(--rau-bg-l1)`, `border-right: 1px solid var(--rau-border-subtle)`, `padding: 0`.

1. **Header** — height 48px, `padding: 0 12px 0 16px`, flush row. Contains the wordmark (left) and a collapse toggle icon button (right). Bottom border `1px solid var(--rau-border-faint)`.
2. **New chat** — 8px outer padding; a full-width 36px row (see §4.3).
3. **Search** — full-width 32px input row, `⌘K` hint on the right in `--rau-text-quaternary`.
4. **Conversation list** — scrollable `1fr`. Padded `0 8px`. Grouped by time with sticky group headers ("Today", "Yesterday", "Previous 7 days", "Older") — 11px uppercase, `--rau-ls-caps`, `--rau-text-quaternary`, height 28px, `padding-left: 8px`, `background: var(--rau-bg-l1)`, sticky top 0.
5. **Workspace section** — pinned above the footer, separated by `1px solid var(--rau-border-faint)` and 8px padding. Rows: *Workspace*, *Skills*, *Files*. Each 32px with a 16px leading icon and a trailing count in `--rau-text-quaternary` `--rau-fs-mini`.
6. **Footer** — 8px padding, top border `1px solid var(--rau-border-faint)`. A single 40px account row: 20px square avatar (radius 3px, never a circle), name at 13px/`--rau-text-primary`, plan at 11px/`--rau-text-quaternary`, trailing settings gear icon button. Opens the settings menu upward.

**Collapsed (56px):** only 20px icon buttons centered; wordmark reduces to the notch mark (§4.1); conversation list hidden; hovering the rail for 400ms peeks the full sidebar as an overlay at 264px with `--rau-elev-popover`, closing 200ms after mouse-out.

### 3.4 Chat column

- Background `--rau-bg-l0`.
- **Top bar**: 48px, sticky, `background: var(--rau-bg-l0)`, `border-bottom: 1px solid transparent` that transitions to `var(--rau-border-subtle)` over `--rau-dur-fast` once `scrollTop > 4`. Contains: conversation title (14px, `--rau-fw-medium`, `--rau-ls-snug`, truncating), a 12px `--rau-text-quaternary` model string, and right-aligned icon buttons (share, branch, overflow, telemetry toggle).
- **Transcript scroller**: `flex: 1; overflow-y: auto; scrollbar-gutter: stable;` Inner column `max-width: var(--rau-measure); margin: 0 auto; padding: 32px 24px 0;`
- **Turn rhythm**: 32px between turns; 12px between a message and its attached tool event cards; 40px above a date separator.
- **Composer dock**: not floating. `position: sticky; bottom: 0;` with `background: var(--rau-bg-l0)` and a 24px tall top gradient mask from `transparent` → `--rau-bg-l0` (this is a legibility mask on a solid color, not decoration; it is the only gradient permitted in the product). Inner column matches the transcript's max-width and padding. Bottom padding 20px.

### 3.5 Message geometry

| | Assistant | User |
|---|---|---|
| Container | Full measure, no bubble, no background | Right-aligned block, `max-width: 560px` |
| Background | `transparent` | `var(--rau-bg-l2)` |
| Border | none | `1px solid var(--rau-border-subtle)` |
| Radius | — | `var(--rau-radius-md)` (5px) |
| Padding | `0` | `10px 14px` |
| Type | 15px/26px `--rau-text-primary` | 15px/24px `--rau-text-primary` |
| Header row | 24px: 16px model glyph + name (13px, `--rau-fw-medium`) + timestamp (11px `--rau-text-quaternary`), margin-bottom 8px | none |
| Action bar | 28px row below content, 8px gap icons, opacity 0 → 1 on turn hover (`--rau-dur-fast`) | same, left-aligned under the block |

The assistant never gets a bubble. Asymmetry (bubble vs. document) is the read cue, not color.

### 3.6 Telemetry panel (320px)

Full spec in §6. Structurally: 48px header, then scrollable body with sections separated by `1px solid var(--rau-border-faint)` and `16px` internal padding; footer pinned with the reserved substrate slot.

---

## 4. Components

Every component: **rest / hover / active(pressed) / focus-visible / selected / disabled / loading** where applicable. Focus-visible is always `box-shadow: var(--rau-focus-ring)` with `outline: none`, and always renders *outside* the element (2px offset via the double-ring token). Focus is never suppressed and never glows.

### 4.1 Wordmark

- Text: `Rauchat` — always one word, never "RauChat", never all-caps.
- Typeface: **Inter** (variable), weight **590**, `font-size: 15px`, `letter-spacing: -0.035em`, `line-height: 1`.
- Two-tone: `Rau` in `--rau-text-primary`, `chat` in `--rau-text-tertiary`. On hover of the sidebar header, `chat` transitions to `--rau-text-secondary` over `--rau-dur-fast`.
- Optional **notch mark**: a 10×10px square, `border: 1px solid var(--rau-border-default)`, `border-radius: 2px`, with a 4×4px `--rau-accent` square inset at its bottom-left (2px from each edge). Sits 8px left of the wordmark. This is the only mark; when the sidebar is collapsed the notch is shown alone, centered.
- Minimum clear space around the lockup: 8px. Never scale below 13px, never above 20px. Never place on `--rau-accent`.

### 4.2 Icon button (32px / 28px small)

| State | Spec |
|---|---|
| rest | 32×32, radius 3px, `background: transparent`, icon 16px `--rau-text-tertiary`, stroke 1.5px |
| hover | `background: var(--rau-fill-hover)`, icon `--rau-text-secondary` |
| active | `background: var(--rau-fill-active)`, icon `--rau-text-primary`, `transform: none` (no press scale on icon buttons) |
| focus-visible | rest visuals + `--rau-focus-ring` |
| selected/on | `background: var(--rau-fill-selected)`, icon `--rau-text-primary` |
| disabled | icon `--rau-text-disabled`, `cursor: not-allowed`, no hover fill |

Transitions: `background-color var(--rau-dur-instant), color var(--rau-dur-fast)`, both `--rau-ease-standard`.

### 4.3 Buttons

Height 32px default / 36px large / 24px small. Padding `0 12px` (large `0 14px`, small `0 8px`). Radius 3px. Label 13px (large 14px), `--rau-fw-medium`, `--rau-ls-snug`. Icon+label gap 6px.

**Primary (accent) — max one per view.**
| State | Spec |
|---|---|
| rest | `background: var(--rau-accent)`, text `--rau-text-on-accent`, no border |
| hover | `background: var(--rau-accent-hover)` |
| active | `background: var(--rau-accent-press)` |
| focus-visible | + `--rau-focus-ring` |
| disabled | `background: #3A2E19`, text `--rau-text-disabled` |
| loading | label stays, 14px indeterminate arc replaces the leading icon; width does not change |

**Secondary (default) — the workhorse, used for "New chat".**
| State | Spec |
|---|---|
| rest | `background: var(--rau-bg-l2)`, `border: 1px solid var(--rau-border-default)`, text `--rau-text-primary` |
| hover | `background: #131316`, `border-color: var(--rau-border-strong)` |
| active | `background: #0A0A0C`, `border-color: var(--rau-border-strong)` |
| focus-visible | + `--rau-focus-ring` |
| disabled | `background: var(--rau-fill-disabled)`, `border-color: var(--rau-border-subtle)`, text `--rau-text-disabled` |

**Ghost:** transparent rest, text `--rau-text-secondary`; hover `--rau-fill-hover` + text `--rau-text-primary`; active `--rau-fill-active`.

**Danger:** ghost geometry; text `--rau-danger`; hover `background: var(--rau-danger-surface)`, text `--rau-danger-hover`.

### 4.4 Sidebar conversation row

Height 32px, radius 3px, `padding: 0 8px`, full-width within the 8px list padding. Title 13px `--rau-ls-snug`, single line, `text-overflow: ellipsis`.

| State | Spec |
|---|---|
| rest | transparent; title `--rau-text-secondary` |
| hover | `background: var(--rau-fill-hover)`; title `--rau-text-primary`; trailing 24px overflow icon button fades in (`--rau-dur-fast`) and the title's right padding animates to 28px |
| active(press) | `background: var(--rau-fill-active)` |
| selected | `background: var(--rau-fill-selected)`; title `--rau-text-primary`, `--rau-fw-medium`; **plus a 2px × 16px `--rau-accent` bar** vertically centered, flush to the row's left edge, radius 1px. This accent bar is the sidebar's only accent. |
| selected + hover | `background: var(--rau-fill-selected-hover)` |
| focus-visible | `--rau-focus-ring` |
| streaming (background turn) | trailing 3px `--rau-accent` dot, `opacity` pulsing 1 → 0.35 → 1 over 1600ms `--rau-ease-inout`, infinite |
| renaming | row becomes an inline input: `background: var(--rau-bg-inset)`, `border: 1px solid var(--rau-accent)`, text `--rau-text-primary`, caret `--rau-accent` |

### 4.5 Composer

Shell: `background: var(--rau-bg-l2)`, `border: 1px solid var(--rau-border-default)`, `border-radius: var(--rau-radius-xl)` (8px), `overflow: hidden`.

| State | Spec |
|---|---|
| rest | as above |
| hover | `border-color: var(--rau-border-strong)` |
| focus-within | `border-color: var(--rau-accent)`; **no glow, no ring** — a 1px amber border is the entire focus signal. `transition: border-color var(--rau-dur-fast)` |
| disabled / generating | `border-color: var(--rau-border-subtle)`, textarea `--rau-text-tertiary`, `cursor: not-allowed`; placeholder becomes "Generating…" |
| drag-over (file drop) | `border: 1px dashed var(--rau-accent)`, `background: var(--rau-accent-surface)`; a 13px centered label "Drop to attach" replaces the textarea content area |
| error | `border-color: var(--rau-danger)`; a 24px strip below the shell, `background: var(--rau-danger-surface)`, 12px `--rau-danger` text |

Internals:
- **Textarea**: `padding: 14px 16px 8px`, 15px/22px, `--rau-text-primary`, `background: transparent`, `resize: none`, `caret-color: var(--rau-accent)`. Placeholder `--rau-text-tertiary`: "Message Rauchat". Auto-grow from 52px shell height; at `--rau-composer-max-h` (240px) it stops growing and scrolls internally, and a 1px `--rau-border-faint` line appears under the textarea to signal the scroll region.
- **Tool bar**: 40px row, `padding: 0 8px 0 10px`, `border-top: 1px solid var(--rau-border-faint)` (only present when the textarea has grown past one line, otherwise borderless). Left: six tool toggles (§4.6) in a horizontally scrollable row with fade-mask edges of 16px. Right: attach icon button, model selector (ghost button 24px, 12px label + chevron), and the send button.
- **Send button**: 28×28, radius 3px. Rest (empty input): `background: transparent`, icon `--rau-text-quaternary`, disabled. Enabled: `background: var(--rau-accent)`, icon `--rau-text-on-accent`; hover `--rau-accent-hover`; active `--rau-accent-press`. Generating: turns into a **stop** button — `background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-strong)`, a 9×9px `--rau-text-primary` square (radius 1px) as the stop glyph.
- Keyboard: `Enter` sends, `Shift+Enter` newline, `⌘/Ctrl+Enter` sends with the current tool set forced on, `Esc` blurs / stops generation.

### 4.6 Tool toggle (composer chip)

Height 24px, radius 3px, `padding: 0 8px 0 6px`, gap 5px, label 12px `--rau-fw-medium` `--rau-ls-snug`, icon 14px.
Order: Web search · Research · PDF · Read file · Write file · Skill maker.

| State | Spec |
|---|---|
| off (rest) | `background: transparent`, `border: 1px solid transparent`, icon+label `--rau-text-tertiary` |
| off hover | `background: var(--rau-fill-hover)`, label `--rau-text-secondary` |
| off active | `background: var(--rau-fill-active)` |
| on | `background: var(--rau-accent-surface)`, `border: 1px solid rgba(232,163,61,0.30)`, icon + label `--rau-accent` |
| on hover | `background: var(--rau-accent-surface-strong)` |
| focus-visible | `--rau-focus-ring` |
| disabled (tool unavailable) | icon+label `--rau-text-disabled`; tooltip states why; no fill on hover |
| running (this turn) | `on` visuals + a 1px `--rau-accent` underline on the bottom edge that sweeps 0 → 100% width over 1200ms `--rau-ease-linear`, infinite |

Below 640px composer width, labels hide and chips become 24×24 icon-only; the active set is summarized as a "3 tools" ghost chip that opens a popover.

### 4.7 Message content (markdown)

Measure 68ch inside the 720px column. Rules:

- **p** 15px/26px, margin-bottom 16px, `--rau-text-primary`.
- **h1** 24px/32px `--rau-fw-semibold` `--rau-ls-tight`, margin 32px top / 12px bottom.
  **h2** 20px/28px `--rau-fw-semibold` `--rau-ls-tight`, 28px/10px.
  **h3** 17px/26px `--rau-fw-medium` `--rau-ls-snug`, 24px/8px.
  Headings never use accent.
- **ul/ol** padding-left 22px, item spacing 6px. Markers `--rau-text-quaternary`; `ul` marker is a 3px square (`▪` replaced by a CSS `::marker` square via `list-style: none` + pseudo-element `4px × 4px`, `background: var(--rau-text-quaternary)`, `border-radius: 1px`, offset `top: 11px`).
- **a** `--rau-text-link`, `text-decoration: underline`, `text-underline-offset: 3px`, `text-decoration-color: var(--rau-text-quaternary)`; hover → `text-decoration-color: var(--rau-accent)`, text `--rau-text-link-hover`. Links are never amber-filled.
- **code (inline)** `--rau-font-mono` 13px, `background: var(--rau-bg-inset)`, `border: 1px solid var(--rau-border-faint)`, radius 3px, padding `1px 5px`, color `#D8D8DC`.
- **pre** `background: var(--rau-bg-inset)`, `border: 1px solid var(--rau-border-subtle)`, radius 6px, padding `12px 14px`, 13px/21px mono, `overflow-x: auto`, margin 16px 0. Header strip 30px: `border-bottom: 1px solid var(--rau-border-faint)`, language label 11px uppercase `--rau-ls-caps` `--rau-text-quaternary` on the left, copy ghost button on the right (label swaps to "Copied" in `--rau-success` for 1400ms).
  Syntax colors (monochrome-leaning, one accent): keyword `#C9C9D1` `--rau-fw-medium`, string `#9FB89F`, number `#D6B27A`, comment `#5A5A63` italic, function `#E8A33D`, punctuation `#6D6D76`, variable `#EDEDEF`.
- **blockquote** `border-left: 2px solid var(--rau-border-default)`, padding-left 14px, text `--rau-text-secondary`.
- **table** full-measure, 13px/20px, header row 11px uppercase `--rau-ls-caps` `--rau-text-tertiary`, cell padding `8px 12px`, row separator `1px solid var(--rau-border-faint)`, wrapper `overflow-x: auto` with radius 5px and `1px solid var(--rau-border-subtle)`.
- **hr** `1px solid var(--rau-border-faint)`, margin 28px 0.
- **KaTeX** inherits `--rau-text-primary`; display math centered with 20px vertical margin.

### 4.8 Streaming affordances

- **Caret**: an 8×16px block (`width: 2px; height: 16px` — a bar, not a block) `background: var(--rau-accent)`, `display: inline-block`, `vertical-align: -2px`, `margin-left: 2px`, `border-radius: 1px`. Animation: `opacity` steps — `1` for 530ms, `0` for 530ms (`steps(1,end)`, infinite). It sits at the end of the last text node and is removed on completion.
- **No shimmer on streaming text.** Text arrives at final color and final opacity. Do not fade in tokens, do not animate text color.
- **Shimmer is permitted in exactly two places**: (a) conversation-list skeletons on cold load, (b) tool-event card bodies awaiting a result. Shimmer spec: a 1.6s linear infinite horizontal sweep, `background: linear-gradient(90deg, #0B0B0D 0%, #131316 50%, #0B0B0D 100%)`, `background-size: 200% 100%`. No accent in shimmer.
- **Thinking indicator** (before first token): a 24px row containing three 3×3px squares (radius 1px) in `--rau-text-quaternary`, 4px apart, each animating `opacity 0.35 → 1 → 0.35` over 1200ms with 160ms stagger. Accompanied by 12px `--rau-text-tertiary` label ("Thinking", or the active tool's verb). Never a spinner, never a bouncing dot.
- **Scroll behavior**: auto-follow while pinned within 48px of the bottom; if the user scrolls up, follow detaches and a 28px "Jump to latest" ghost pill (radius 3px, `background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-default)`) appears centered 20px above the composer, entering with `opacity 0→1` + `translateY(4px→0)` over `--rau-dur-base`.

### 4.9 Message action bar

28px tall, appears on turn hover or keyboard focus within the turn. Icons 14px, 28×28 hit areas, gap 2px: Copy, Regenerate, Branch, Good, Bad, More. Rest `opacity: 0`; hover `opacity: 1` over `--rau-dur-fast`. On touch/coarse pointers it is always visible at `opacity: 0.6`. Selected feedback (Good/Bad) latches the icon to `--rau-text-primary` with `background: var(--rau-fill-selected)`.

### 4.10 Popover / dropdown menu

`background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-default)`, radius 6px, `box-shadow: var(--rau-elev-popover)`, padding 4px, min-width 200px.
Item: 30px, radius 3px, padding `0 8px`, 13px `--rau-text-secondary`, leading 14px icon, trailing shortcut in 11px `--rau-text-quaternary` mono.
States: hover/keyboard-highlight → `background: var(--rau-fill-hover)`, text `--rau-text-primary`; active → `--rau-fill-active`; checked → trailing 12px check in `--rau-accent`; destructive → text `--rau-danger`, hover `background: var(--rau-danger-surface)`; disabled → `--rau-text-disabled`, no fill.
Separator: `1px solid var(--rau-border-faint)`, margin `4px -4px`.
Enter: `opacity 0→1`, `translateY(-3px→0)`, `--rau-dur-base --rau-ease-standard`, `transform-origin` at the trigger edge. Exit: `opacity 1→0` over `--rau-dur-fast --rau-ease-exit`, no transform.

### 4.11 Tooltip

`background: #1B1B1F`, `border: 1px solid var(--rau-border-default)`, radius 3px, padding `4px 7px`, 12px/16px `--rau-text-secondary`, max-width 220px. Shortcut hint appended in `--rau-text-quaternary` mono 11px. Delay-in 400ms (0ms if another tooltip is already open within 300ms), delay-out 0ms. Enter: `opacity 0→1` + `translateY(2px→0)` over 120ms. No arrow. Never contains interactive content.

### 4.12 Input / textarea (settings, search, rename)

Height 32px, radius 3px, `background: var(--rau-bg-inset)`, `border: 1px solid var(--rau-border-default)`, padding `0 10px`, 13px `--rau-text-primary`, placeholder `--rau-text-quaternary`, `caret-color: var(--rau-accent)`.
hover → `border-color: var(--rau-border-strong)`. focus → `border-color: var(--rau-accent)`, `background: var(--rau-bg-l2)` (no ring — border is the signal, matching the composer). invalid → `border-color: var(--rau-danger)` + 12px `--rau-danger` helper text 6px below. disabled → `background: var(--rau-fill-disabled)`, text `--rau-text-disabled`.
Selection globally: `::selection { background: rgba(232,163,61,0.26); color: #FFFFFF; }`

### 4.13 Toggle / switch, checkbox, segmented control

- **Switch**: 28×16px track, radius 8px. Off: `background: #26262B`, knob 12×12 radius 6 `#6D6D76`, inset 2px. On: track `--rau-accent`, knob `#140D02`. Transition `background-color var(--rau-dur-fast)`, knob `transform: translateX(12px)` over `--rau-dur-fast --rau-ease-standard`. Focus: `--rau-focus-ring`. Disabled: track `--rau-fill-disabled`, knob `--rau-text-disabled`.
- **Checkbox**: 14×14, radius 2px, `border: 1px solid var(--rau-border-strong)`. Checked: `background: var(--rau-accent)`, 10px `--rau-text-on-accent` check, `border-color: var(--rau-accent)`. Indeterminate: 8×1.5px bar.
- **Segmented control**: 28px tall container, `background: var(--rau-bg-inset)`, `border: 1px solid var(--rau-border-subtle)`, radius 4px, 2px padding. Segment: radius 2px, 12px `--rau-text-tertiary`; selected → `background: var(--rau-bg-l3)`, text `--rau-text-primary`, and the selection indicator slides via `transform` over `--rau-dur-fast --rau-ease-standard`.

### 4.14 Modal & toast

- **Modal**: `background: var(--rau-bg-l4)`, `border: 1px solid var(--rau-border-default)`, radius 8px, `box-shadow: var(--rau-elev-modal)`, width 480px (large 640px), padding 20px 24px 24px. Title 20px `--rau-fw-semibold` `--rau-ls-tight`. Scrim `--rau-scrim`, **no blur**. Enter: scrim `opacity 0→1` 130ms; panel `opacity 0→1` + `translateY(6px→0)` + `scale(0.99→1)` over `--rau-dur-base --rau-ease-standard`. Exit: 130ms `--rau-ease-exit`, no scale.
- **Toast**: bottom-right, 320px, `background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-default)`, radius 5px, `--rau-elev-popover`, padding 10px 12px, 13px. A 2px left rule in the semantic color (`--rau-success` / `--rau-danger` / `--rau-accent`) is the only color. Auto-dismiss 5000ms with a 1px bottom progress rule in `--rau-border-strong` shrinking linearly. Enter `translateY(8px→0)` + fade, `--rau-dur-base`.

### 4.15 Skills & workspace list item

52px row, radius 3px, `padding: 0 10px`, two-line: name 13px `--rau-fw-medium` `--rau-text-primary`; description 12px `--rau-text-tertiary` truncated to one line. Trailing 20px switch (enabled/disabled). Hover `--rau-fill-hover` + trailing "Edit" ghost button fades in. A skill authored by Skill Maker shows a 16px "Generated" tag: 11px `--rau-ls-wide`, `--rau-text-quaternary`, `border: 1px solid var(--rau-border-subtle)`, radius 2px, padding `0 4px`.

---

## 5. Motion

**5.1 Budget.** Nothing animates longer than 240ms. Nothing animates that the user did not cause, except: the streaming caret, the thinking indicator, the running-tool underline, the sidebar streaming dot, and telemetry bar interpolation. Nothing loops that is not communicating live state.

**5.2 Property allowlist.** Animate only `opacity`, `transform`, `background-color`, `border-color`, `color`, `box-shadow` (focus ring only), and `width`/`height` for panel collapse (accepted layout cost, `--rau-dur-slow`). Never animate `filter`, `backdrop-filter`, `letter-spacing`, or gradients.

**5.3 Standard durations by class.**

| Interaction | Duration | Easing |
|---|---|---|
| Background fill on hover | 90ms | `--rau-ease-standard` |
| Border / text / icon color | 130ms | `--rau-ease-standard` |
| Popover, tooltip, toast, card enter | 170ms | `--rau-ease-standard` |
| Any exit | 130ms | `--rau-ease-exit` |
| Panel collapse/expand, sidebar width | 200ms | `--rau-ease-inout` |
| Telemetry bar length + numeral roll | 240ms | `--rau-ease-standard` |
| Focus ring appearance | 0ms (instant) | — |

**5.4 Transform vocabulary.** Enter offsets are 3–8px only. Scale is used once (modal, 0.99→1). No rotation except the 12px chevron (`transform: rotate(180deg)`, 130ms). No press-scale on any control smaller than 32px; buttons ≥32px may use `transform: scale(0.985)` on `:active` for 90ms.

**5.5 Staggering.** Lists never stagger on load. The only stagger in the product is the thinking indicator's three squares (160ms) and the telemetry axes on first connect (§6.6, 24ms × index, capped at 8 items).

**5.6 Reduced motion.**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```
Exceptions that must still communicate: the streaming caret becomes a static, non-blinking `--rau-accent` bar; the thinking indicator becomes a static three-square glyph with the text label doing the work; telemetry bars snap to their new length.

---

## 6. Telemetry panel spec

Header: "MODEL TELEMETRY" — 11px, `--rau-fw-medium`, `--rau-ls-caps`, uppercase, `--rau-text-tertiary`. Collapse chevron on the right (32px icon button). Height 48px, `padding: 0 8px 0 16px`, `border-bottom: 1px solid var(--rau-border-faint)`.

Body sections in order: **A. Connection** → **B. Axes** → **C. Turn history** → **D. Substrate (reserved)**. Each section is separated by `1px solid var(--rau-border-faint)` and padded `16px`. Section labels use the same 11px caps style as the header, with `margin-bottom: 12px`.

### 6.1 A — Connection state

A single 44px block: `background: var(--rau-bg-l2)`, `border: 1px solid var(--rau-border-subtle)`, radius 4px, `padding: 0 12px`, flex row.
Left: 6px status dot (radius full) + two stacked lines — line 1 is the state label (12px `--rau-fw-medium` `--rau-text-primary`), line 2 is the detail (11px `--rau-text-quaternary`, mono, tabular).
Right: a 24px ghost icon button (retry / details).

| State | Dot | Label | Detail line | Extra |
|---|---|---|---|---|
| **dormant** (default; weights not loaded) | `--rau-status-dormant`, hollow: `background: transparent; border: 1px solid var(--rau-status-dormant)` | `Awaiting substrate` | `gemma-4-12b · weights not loaded` | Panel body renders in **dormant treatment** (§6.5). Right button = "Load" ghost button, 24px, 12px label. |
| **connecting** | `--rau-status-connecting`, solid, opacity pulse 1→0.4→1 over 1400ms `--rau-ease-inout` | `Connecting` | `handshake · <elapsed>s` | A 1px `--rau-accent-track` rule spans the block's bottom edge with a 24px `--rau-accent` segment translating left→right over 1100ms linear infinite. |
| **live** | `--rau-status-live`, solid, with a 1400ms `opacity 1→0.55→1` breathe | `Live` | `gemma-4-12b · <ms> ms · turn <n>` | — |
| **degraded** | `--rau-warning` solid | `Degraded` | `partial axes · <k>/8 reporting` | Non-reporting axes render dormant. |
| **error** | `--rau-status-error` solid | `Disconnected` | truncated reason, e.g. `remote refused (503)` | Block border → `--rau-border-danger`; right button = "Retry" ghost in `--rau-danger`. |

The dormant state must never use a spinner, a skeleton, a red color, or the word "error"/"failed". It is a powered-down instrument, and it is the *designed* default.

### 6.2 B — Axis readouts (the core)

Eight rows, `--rau-space-5` (12px) apart. Row height 34px. Order is fixed:

| # | Axis id | + pole (left, accent) | − pole (right, gray) |
|---|---|---|---|
| 1 | `factual_hallucinatory` | factual | hallucinatory |
| 2 | `serious_funny` | serious | funny |
| 3 | `casual_formal` | casual | formal |
| 4 | `creative_empirical` | creative | empirical |
| 5 | `honest_sycophantic` | honest | sycophantic |
| 6 | `confident_unsure` | confident | unsure |
| 7 | `empathetic_unempathetic` | empathetic | unempathetic |
| 8 | `calm_anxious` | calm | anxious |

**Row anatomy** (top to bottom, 288px content width inside the 320px panel):

1. **Label line**, 16px tall, flex `space-between`:
   - Left: `+` pole name, 11px, `--rau-ls-caps`, uppercase, color `--rau-text-tertiary`; becomes `--rau-text-secondary` when the value is positive.
   - Center: the numeric value, 12px mono, `font-variant-numeric: tabular-nums`, always signed and 2-decimal (`+0.42`, `−0.08`, using U+2212 minus). Color `--rau-text-primary` when |v| ≥ 0.15, else `--rau-text-tertiary`. Dormant: `—` in `--rau-text-quaternary`.
   - Right: `−` pole name, same style, `--rau-text-secondary` when the value is negative.
2. **Gap** 6px.
3. **Bar**, 8px tall, full row width, `background: var(--rau-bg-inset)`, radius 2px, `position: relative`, with:
   - a center tick: 1px × 12px, `background: var(--rau-tel-center-tick)`, centered, extending 2px above and below the bar;
   - two gridlines at ±0.5: 1px × 8px, `background: var(--rau-tel-grid)`;
   - the fill: absolutely positioned, `height: 8px`, radius 2px, anchored at the 50% centerline, growing left for positive (`--rau-tel-pos`) and right for negative (`--rau-tel-neg`). Width = `|v| × 50%` of the track. Minimum rendered width 2px for any non-zero value so tiny values remain visible.
   - **confidence**: the judge returns a confidence 0–1 per axis. It modulates fill `opacity` linearly from `0.45` (conf 0) to `1.0` (conf 1). It never changes hue. Confidence < 0.35 additionally renders the fill with a 1px `--rau-border-default` outline and no solid fill (hollow bar).
4. **Delta chip** (only when the value changed this turn), anchored to the bar's outer end, 14px tall, 11px mono, `--rau-text-quaternary`: `▲0.11` / `▼0.06` rendered as a 1.5px-stroke caret glyph, not an emoji. Fades in over `--rau-dur-base`, fades out after 6s.

**Row states**

| State | Spec |
|---|---|
| rest (live) | as above |
| hover | row `background: var(--rau-fill-hover)` extending 8px beyond the content box (negative margin), radius 3px; both pole labels → `--rau-text-secondary`; a tooltip after 400ms shows the judge's one-line rationale, confidence, and evidence span |
| focus-visible (row is tabbable) | `--rau-focus-ring` on the row |
| updating | fill width transitions over `--rau-dur-telemetry`; the numeral counts to its new value over the same duration (integer-step interpolation on the hundredths digit); the label line's active pole flashes to `--rau-text-primary` for 240ms then settles |
| stale (no update for ≥ 2 turns) | fill uses `--rau-tel-pos-dim` / `--rau-tel-neg-dim`; numeral drops to `--rau-text-tertiary` |
| dormant | see §6.5 |
| pinned | user can pin up to 3 axes; pinned rows move to the top of the list with a `1px solid var(--rau-border-subtle)` bottom rule under the pinned group and a 2px × 10px `--rau-accent` mark at the row's left edge |

**Accessibility.** Each row is `role="meter"` with `aria-valuemin="-1" aria-valuemax="1" aria-valuenow` and an `aria-label` of the form `factual versus hallucinatory: plus 0.42, confidence 0.81`. Because hue alone encodes direction, the signed numeral and the emphasized pole label are the redundant non-color cues (required).

### 6.3 C — Per-turn history

Compact, 8 stacked rows — one per axis, same order, no re-labeling beyond a 3-letter abbreviation.

- Section height: 8 rows × 18px + 12px label = 156px.
- Row: `[abbr 34px][sparkline 1fr][value 34px]`.
  - **abbr**: 10px uppercase `--rau-ls-caps` `--rau-text-quaternary` — `FCT SER CAS CRE HON CNF EMP CLM`.
  - **sparkline**: SVG, height 14px, width fills (~180px), showing the last **24 turns**. A 1px `--rau-tel-grid` horizontal centerline at 0.0 spans full width. Polyline stroke `--rau-tel-spark`, `stroke-width: 1`, `stroke-linejoin: round`, `fill: none`, `vector-effect: non-scaling-stroke`. The latest point is a 2.5px radius dot in `--rau-tel-spark-head`. Points are evenly spaced; missing turns break the polyline (no interpolation across gaps) and are marked with a 1px × 3px `--rau-text-quaternary` tick on the centerline.
  - **value**: current value, 11px mono tabular, `--rau-text-tertiary`, right-aligned.
- Hover anywhere in the section draws a 1px vertical `--rau-border-strong` crosshair across **all eight** sparklines at the hovered turn index, and every row's value swaps to that turn's value (returning on mouse-out). A 11px `--rau-text-quaternary` caption above the section shows `turn 17 · 14:22:06`. This synchronized crosshair is the section's whole reason to exist — implement it.
- Click a turn index → scrolls the transcript to that turn and flashes the turn's left edge with a 2px `--rau-accent` rule for 600ms.
- Alternative dense mode (user toggle, 11px ghost link "stacked"): replaces sparklines with 8 rows of 24 cells, each 5×10px, colored `--rau-tel-pos`/`--rau-tel-neg` at `opacity = 0.25 + 0.75·|v|`, 1px gap. Same crosshair behavior.

### 6.4 D — Substrate (reserved slot)

Present from day one, explicitly reserved for layer/weight metadata.

- Section label: `SUBSTRATE`.
- Container: `border: 1px dashed var(--rau-border-subtle)`, radius 4px, `padding: 12px`, `background: transparent`.
- Four label/value rows, 20px each, 11px labels `--rau-text-quaternary` left, values 11px mono right:
  `layer range` · `projection rank` · `steering α` · `vector build`.
- Dormant values render as `—` in `--rau-text-quaternary`. When populated, values render `--rau-text-secondary` and the container border becomes solid `--rau-border-subtle`.
- Below the rows, a 11px `--rau-text-quaternary` line: `Reserved — populated when the evaluator reports layer metadata.` This copy ships in v1; it is the honest statement of the slot's purpose and prevents the empty box reading as broken.

### 6.5 Dormant treatment (default state, must look intentional)

When connection state is `dormant`, the whole body renders as a powered-down instrument:

- Axis rows still render **in full**: pole labels at `--rau-text-quaternary`, center tick at `--rau-border-default`, bar track at `--rau-bg-inset`, and a **2px-wide `--rau-tel-dormant` stub centered on the zero tick** (so every axis reads as "present, unmeasured" rather than empty).
- Numerals render `—`.
- Sparklines render only their centerline in `--rau-tel-grid`; no polyline, no head dot.
- Panel-wide `opacity` stays at 1 — do **not** dim the panel wholesale; the calm comes from token choice, not transparency.
- One 32px full-width secondary button at the bottom of section A: **"Load evaluator"**, plus an 11px `--rau-text-quaternary` line under it: `Gemma 4 12B · remote · not resident`.
- No skeleton shimmer, no spinner, no dashed borders on axis rows, no "N/A", no error color, no illustration.

### 6.6 Connect animation

On dormant → connecting → live, in order:
1. Status dot cross-fades over 130ms.
2. Axis stubs expand from 2px to their measured widths, `--rau-dur-telemetry`, `--rau-ease-standard`, staggered 24ms by row index (8 rows → 168ms total).
3. Numerals fade `—` → value over 130ms, no counting on first paint.
4. Sparklines draw with `stroke-dasharray` reveal over 200ms linear. This is the single path-drawing animation in the product; it does not repeat.

### 6.7 Collapsed rail (44px)

Vertical strip, `bg: var(--rau-bg-l1)`, `border-left: 1px solid var(--rau-border-subtle)`.
Top: 32px expand icon button. Below: the status dot (6px, centered, same state colors), then a 3px gap, then **eight 3px-wide vertical mini-bars**, 40px tall each, stacked with 6px gaps — each a miniature vertical diverging bar (center tick at the midpoint, fill growing up for `+`, down for `−`, same hues). Hovering the rail shows a tooltip with the axis name and value. Clicking anywhere on the rail expands the panel.

---

## 7. Tool event cards

Tool events render inline in the transcript, in-flow with the assistant's message (not in a separate lane), at the point of invocation.

**Shell**
- Width: full measure. `background: var(--rau-bg-l2)`, `border: 1px solid var(--rau-border-subtle)`, `border-radius: var(--rau-radius-md)` (5px), `margin: 12px 0`, `overflow: hidden`.
- **Header row**: 36px, `padding: 0 10px 0 12px`, flex, gap 8px.
  - 14px tool icon, `--rau-text-tertiary` (running: `--rau-accent`).
  - Tool name, 12px `--rau-fw-medium` `--rau-ls-snug` `--rau-text-secondary`.
  - Primary argument, 12px `--rau-text-tertiary`, truncating with `min-width: 0` — e.g. the query, the path.
  - Spacer.
  - Duration, 11px mono `--rau-text-quaternary` (`1.4s`).
  - 20px disclosure chevron, rotates 180° over 130ms when expanded.
- **Body** (when expanded): `border-top: 1px solid var(--rau-border-faint)`, `padding: 10px 12px 12px`, `background: var(--rau-bg-inset)`. Max-height 320px with internal scroll; a "Show all (N)" ghost link at the bottom when truncated.
- Cards are **collapsed by default once complete**, and **auto-expanded while running**. `pdf_create` and `skill_maker` stay expanded on completion (their result is the deliverable).

**States**

| State | Header | Left edge | Body |
|---|---|---|---|
| queued | icon + name at `--rau-text-quaternary`; duration slot shows `queued` | none | hidden |
| running | icon `--rau-accent`; name `--rau-text-primary`; duration counts up in mono, updating at 10Hz | 2px × full-height `--rau-accent` rule flush to the card's left inner edge | expanded; content shimmer (§4.8) until first partial result, then live-appending lines |
| success | icon `--rau-text-tertiary`; name `--rau-text-secondary`; final duration | none | collapsed (per rule above) |
| empty result | as success, plus a 12px `--rau-text-tertiary` body line: `No results.` | none | collapsed |
| error | icon `--rau-danger`; name `--rau-text-primary`; duration replaced by `failed` in `--rau-danger` | 2px `--rau-danger` rule | auto-expanded, body shows the error message in 12px `--rau-danger` on `--rau-danger-surface`, plus a "Retry" ghost button |
| cancelled | icon + name `--rau-text-quaternary`; `stopped` label | none | collapsed |
| hover (header) | `background: var(--rau-fill-hover)` | — | — |
| focus-visible | `--rau-focus-ring` on the header row | — | — |

Enter animation: `opacity 0→1` + `translateY(4px→0)` over `--rau-dur-base --rau-ease-standard`. Expand/collapse: `grid-template-rows: 0fr → 1fr` over `--rau-dur-base --rau-ease-standard` (no max-height hacks), body `opacity` 0→1 over 130ms delayed 40ms.

**Per-tool body specifications**

1. **Web search** (`web_search`) — header arg is the query in quotes. Body: a list of 24px result rows: favicon 12px (radius 2px, fallback = a 12px `--rau-bg-l3` square with the domain's first letter in 9px `--rau-text-quaternary`), title 12px `--rau-text-secondary` truncating, domain 11px `--rau-text-quaternary`. Hover row → `--rau-fill-hover`, title `--rau-text-primary`. Max 5 shown, then "Show all (N)".
2. **Multi-turn research** (`research`) — header arg is the objective. Body is a **step ledger**: rows of `[16px gutter][step label][duration]`. The gutter draws a 1px `--rau-border-default` vertical connector between steps and, per step, a 5×5px square node (radius 1px): pending `--rau-border-strong` hollow, running `--rau-accent` solid, done `--rau-text-quaternary` solid, failed `--rau-danger` solid. Step label 12px; the running step's label is `--rau-text-primary`, others `--rau-text-tertiary`. A 12px `--rau-text-quaternary` summary line at the bottom: `<n> sources · <m> steps · <t>s`. No progress bar.
3. **PDF create** (`pdf_create`) — body is an artifact row, 56px: a 40×52px page thumbnail (`background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-default)`, radius 3px, first-page render or a 3-line 1px `--rau-border-strong` glyph fallback), filename 13px `--rau-text-primary`, meta 11px mono `--rau-text-quaternary` (`8 pages · 214 KB`), trailing Download secondary button + Preview ghost button. Stays expanded.
4. **File read** (`file_read`) — header arg is the path in mono 12px, middle-truncated. Body: a code block (§4.7 `pre` styling, no header strip) showing max 20 lines with line numbers in `--rau-text-quaternary` (mono 11px, right-aligned, 32px gutter, `border-right: 1px solid var(--rau-border-faint)`), then `⋯ 412 more lines` in 11px `--rau-text-quaternary`.
5. **File write** (`file_write`) — header arg is the path plus a diff stat: `+42 −7` where `+n` is `--rau-success` and `−n` is `--rau-danger`, 11px mono. Body: unified diff. Added lines `background: rgba(62,158,107,0.09)` with a 2px `--rau-success` left rule; removed lines `background: rgba(220,74,80,0.09)` with a 2px `--rau-danger` left rule; context lines plain on `--rau-bg-inset`. Never use red/green *text* color for diff bodies — text stays `--rau-text-secondary`; the rule and tint carry the meaning.
6. **Skill maker** (`skill_maker`) — body: skill name 13px `--rau-fw-medium` `--rau-text-primary`; description 12px `--rau-text-secondary`; a 1px `--rau-border-faint` divider; then a 2-column metadata grid (11px labels `--rau-text-quaternary` / values `--rau-text-secondary`): `trigger`, `tools`, `files`, `scope`. Footer row: "Install skill" secondary button + "View source" ghost button. Once installed, the footer collapses to a 12px `--rau-success` line: `Installed to Workspace › Skills`. Stays expanded.

**Grouping.** Three or more consecutive completed tool events of the same type collapse into one card whose header reads `Web search · 4 queries` with a chevron; expanding lists the individual cards nested with a 12px left indent and a 1px `--rau-border-faint` left rule.

---

## 8. Empty & edge states

**Global empty-state formula.** Centered column, `max-width: 380px`. No illustration, no emoji, no icon larger than 20px. Optional 20px line icon in `--rau-text-quaternary`, 16px gap, headline 15px `--rau-fw-medium` `--rau-text-primary`, 8px gap, body 13px/20px `--rau-text-tertiary`, 20px gap, at most one secondary button. Never centered vertically in a tall viewport — sit at 38% from the top.

| Case | Copy & treatment |
|---|---|
| **No conversations** (sidebar) | 12px `--rau-text-quaternary`, left-aligned at the list's padding, single line: `No conversations yet.` No button (the New chat button is directly above it). |
| **New chat** (empty transcript) | The wordmark at 20px, centered, at 38% viewport height, `Rau` primary / `chat` tertiary. Below it, 13px `--rau-text-tertiary`: `Start a conversation. Tools are off by default.` Below that, a single row of four 26px ghost suggestion chips (12px, `border: 1px solid var(--rau-border-subtle)`, radius 3px) — hover → `--rau-fill-hover` + `--rau-border-default`. The composer is docked as normal. No greeting, no name, no "How can I help you today?". |
| **Search: no results** | 13px `--rau-text-tertiary` centered in the list area: `No conversations match “<query>”.` plus a ghost "Clear search" button. |
| **Skills empty** | Headline `No skills installed`; body `Skills are reusable procedures. Ask Rauchat to build one, or install from a file.`; button `New skill`. |
| **Telemetry dormant** | §6.5. This is the default, and it must never route through this generic empty-state formula. |
| **Telemetry live, zero turns** | Axes render at exactly 0.00 with the 2px centered stub; history section shows centerlines only and a 11px `--rau-text-quaternary` caption `Awaiting first turn.` |
| **Telemetry degraded** | Reporting axes render normally; non-reporting axes use the dormant stub and `—`. A 24px strip at the top of section B: `background: var(--rau-warning-surface)`, 11px `--rau-warning`, `4/8 axes reporting`. |
| **Message generation failed** | In-transcript block replacing the assistant turn: `border: 1px solid var(--rau-border-danger)`, `background: var(--rau-danger-surface)`, radius 5px, padding 10px 12px; 13px `--rau-text-primary` message; 12px mono `--rau-text-tertiary` request id; "Retry" secondary + "Copy details" ghost. |
| **Offline** | A 28px bar directly above the composer, inside the measure: `background: var(--rau-bg-l3)`, `border: 1px solid var(--rau-border-default)`, radius 3px, 12px `--rau-text-secondary`, with a 5px `--rau-neutral-status` dot: `Offline — messages will send when the connection returns.` Composer stays interactive; send button goes disabled. |
| **Rate limited** | Same bar, `--rau-warning` dot, `Rate limit reached. Retry in <mm:ss>.` with a live tabular countdown. |
| **Long message truncated** | Assistant turns over 1600px tall clamp with a 64px bottom mask (solid-color gradient, permitted per §3.4) and a centered 26px ghost "Show more" button. |
| **Attachment too large / unsupported** | Composer error strip (§4.5), 12px `--rau-danger`: `PDF exceeds 32 MB.` Auto-clears on next keystroke. |
| **Conversation deleted / not found** | Full chat column: headline `Conversation unavailable`; body `It may have been deleted or you no longer have access.`; button `New chat`. |
| **Cold load** | Sidebar shows 6 skeleton rows: 32px tall, an inner 1px-radius bar of `--rau-bg-l2` at widths 82%/64%/91%/57%/74%/68%, with shimmer per §4.8. Transcript shows **nothing** (no skeleton) until the first turn resolves — a blank measure is calmer than fake text. Telemetry shows the dormant state. |
| **Keyboard-only navigation** | A skip link (`Skip to composer`) appears on first Tab: `position: fixed; top: 8px; left: 8px;` secondary button styling, `--rau-focus-ring`. Landmark order: sidebar nav → transcript (`role="log"`, `aria-live="polite"` on completed turns only, never on streaming tokens) → composer → telemetry (`role="complementary"`). |

---

### Appendix — implementation checklist

- [ ] Every color used resolves to a `--rau-*` token; zero literal hex outside `:root`.
- [ ] `--rau-accent` appears ≤ 3 times per viewport (telemetry fills count as one group).
- [ ] Zero `backdrop-filter`, zero colored `box-shadow`, zero `linear-gradient` except the two solid-color legibility masks (§3.4, §8).
- [ ] Max `border-radius` outside the composer/modal is 6px.
- [ ] Every interactive element has a visible `:focus-visible` ring.
- [ ] All numeric readouts use `font-variant-numeric: tabular-nums`.
- [ ] Telemetry direction is conveyed by numeral + emphasized pole label, not hue alone.
- [ ] `prefers-reduced-motion` block present; caret and thinking indicator have static fallbacks.
- [ ] No emoji in any chrome string.
