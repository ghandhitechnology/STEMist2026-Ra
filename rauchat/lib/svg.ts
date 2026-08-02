/**
 * lib/svg.ts — SVG helpers shared by client and server.
 *
 * Isomorphic: no server-only imports, so both the `svg_render` tool
 * (lib/server/tools.ts) and any client-side rendering can share the exact
 * same sanitization and detection logic. `sanitizeSvg` decides what's safe
 * to inject; `prepareSvgForChat` then forces the transparent line-drawing
 * look (stroke via currentColor, no page backdrop) for chat rendering.
 */

/** Elements removed outright, including their content. */
const DANGEROUS_ELEMENTS = [
  "script",
  "foreignObject",
  "iframe",
  "embed",
  "object",
  "link",
  "meta",
];

/**
 * Trimmed content, optionally preceded by an `<?xml ...?>` declaration
 * and/or a `<!DOCTYPE ...>`, starts with `<svg` and contains a closing
 * `</svg>` tag somewhere in the document.
 */
export function looksLikeSvg(content: string): boolean {
  let body = content.trim();
  body = body.replace(/^<\?xml[^>]*\?>\s*/i, "");
  body = body.replace(/^<!DOCTYPE[^>]*>\s*/i, "");
  return /^<svg[\s/>]/i.test(body) && /<\/svg\s*>/i.test(content);
}

/**
 * Pulls a standalone SVG document out of model output that may wrap it in
 * markdown fences or prose. Returns the original trimmed string when nothing
 * better can be found (so `sanitizeSvg` can still reject it).
 */
export function extractSvgMarkup(content: string): string {
  const trimmed = content.trim();
  if (looksLikeSvg(trimmed)) return trimmed;

  const fenced = /```(?:svg|xml)?\s*\r?\n([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    const inner = fenced[1].trim();
    if (looksLikeSvg(inner)) return inner;
  }

  const embedded = /<svg\b[\s\S]*?<\/svg\s*>/i.exec(trimmed);
  if (embedded && looksLikeSvg(embedded[0])) return embedded[0];

  return trimmed;
}

/** Opening `<svg …>` tag, quote-aware so `>` inside attribute values is fine. */
const OPEN_SVG_RE =
  /<svg\b([^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*)>/i;

/**
 * Makes sanitized SVG safe to show as an `<img src="data:image/svg+xml…">`.
 * Data-URL / `<img>` rendering needs a real XML SVG document: an `xmlns`,
 * and concrete (non-percentage) width/height — otherwise browsers often
 * report a 0×0 intrinsic size and the figure collapses blank in chat.
 */
export function normalizeSvgForImage(svg: string): string {
  return svg.replace(OPEN_SVG_RE, (_full, rawAttrs: string) => {
    let attrs = rawAttrs;

    if (!/\bxmlns\s*=/i.test(attrs)) {
      attrs = ` xmlns="http://www.w3.org/2000/svg"${attrs}`;
    }

    const vbMatch =
      /\bviewBox\s*=\s*(["'])([^"']+)\1/i.exec(attrs) ??
      /\bviewBox\s*=\s*([^\s>]+)/i.exec(attrs);
    const vbParts = vbMatch
      ? (vbMatch[2] ?? vbMatch[1]).trim().split(/[\s,]+/)
      : null;
    const vbW = vbParts && vbParts.length === 4 ? vbParts[2] : null;
    const vbH = vbParts && vbParts.length === 4 ? vbParts[3] : null;

    const widthMatch = /\bwidth\s*=\s*(["']?)([^"'\s>]+)\1/i.exec(attrs);
    const heightMatch = /\bheight\s*=\s*(["']?)([^"'\s>]+)\1/i.exec(attrs);
    const widthBad =
      !widthMatch || /%$/.test(widthMatch[2]) || /^auto$/i.test(widthMatch[2]);
    const heightBad =
      !heightMatch ||
      /%$/.test(heightMatch[2]) ||
      /^auto$/i.test(heightMatch[2]);

    if (vbW && vbH && (widthBad || heightBad)) {
      attrs = attrs
        .replace(/\s*\bwidth\s*=\s*(["']?)[^"'\s>]+\1/i, "")
        .replace(/\s*\bheight\s*=\s*(["']?)[^"'\s>]+\1/i, "");
      attrs = ` width="${vbW}" height="${vbH}"${attrs}`;
    }

    return `<svg${attrs}>`;
  });
}

/** White / near-white fills that read as a page backdrop. */
const PAGE_FILL_RE =
  /^(?:#fff(?:fff)?|#f[4-9a-f]{5}|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;

/** Near-black ink that should follow the chat theme via currentColor. */
const INK_COLOR_RE =
  /^(?:#0{3,6}|#000000|#1[0-6][0-9a-f]{4}|black)$/i;

const QUOTED_ATTR = (name: string) =>
  new RegExp(`\\s*\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, "i");
const UNQUOTED_ATTR = (name: string) =>
  new RegExp(`\\s*\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i");

function readAttr(attrs: string, name: string): string | null {
  const quoted = QUOTED_ATTR(name).exec(attrs);
  if (quoted) return quoted[2];
  const bare = UNQUOTED_ATTR(name).exec(attrs);
  return bare ? bare[1] : null;
}

function stripAttr(attrs: string, name: string): string {
  return attrs
    .replace(QUOTED_ATTR(name), "")
    .replace(UNQUOTED_ATTR(name), "");
}

/**
 * Forces the Rauchat line-drawing look: transparent backdrop, stroke ink via
 * `currentColor`, no solid page fill. Runs after sanitize. Shape fills that
 * aren't text are cleared so models can't leave opaque blobs behind; text
 * keeps `currentColor` so labels stay legible.
 */
export function stylizeSvgAsLineDrawing(svg: string): string {
  let out = normalizeSvgForImage(svg);

  out = out.replace(OPEN_SVG_RE, (_full, rawAttrs: string) => {
    let attrs = stripAttr(stripAttr(rawAttrs, "style"), "fill");
    attrs = stripAttr(attrs, "stroke");
    attrs = stripAttr(attrs, "stroke-width");
    attrs += ` fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
    return `<svg${attrs}>`;
  });

  // Drop full-bleed white backdrop rects (common LLM habit).
  out = out.replace(
    /<rect\b([^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*)\/?>/gi,
    (tag, rawAttrs: string) => {
      const fill = readAttr(rawAttrs, "fill");
      if (!fill || !PAGE_FILL_RE.test(fill.trim())) return tag;
      const x = readAttr(rawAttrs, "x") ?? "0";
      const y = readAttr(rawAttrs, "y") ?? "0";
      if (x === "0" && y === "0") return "";
      return tag;
    }
  );

  // Quote-aware tag rewrite for shapes / text presentation.
  out = out.replace(
    /<([a-zA-Z][\w:-]*)\b([^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*)(\/?)\s*>/g,
    (tag, name: string, rawAttrs: string, selfClose: string) => {
      const lower = name.toLowerCase();
      if (lower === "svg") return tag;

      let attrs = rawAttrs;
      const fill = readAttr(attrs, "fill");
      const stroke = readAttr(attrs, "stroke");

      if (lower === "text" || lower === "tspan") {
        if (fill && (PAGE_FILL_RE.test(fill.trim()) || INK_COLOR_RE.test(fill.trim()))) {
          attrs = stripAttr(attrs, "fill");
          attrs += ` fill="currentColor"`;
        } else if (!fill) {
          attrs += ` fill="currentColor"`;
        }
      } else if (fill && !/^none$/i.test(fill.trim()) && !/^url\(/i.test(fill.trim())) {
        // Line drawings only — solid shape fills become outlines.
        attrs = stripAttr(attrs, "fill");
        attrs += ` fill="none"`;
        if (!stroke) attrs += ` stroke="currentColor"`;
      }

      if (stroke && INK_COLOR_RE.test(stroke.trim())) {
        attrs = stripAttr(attrs, "stroke");
        attrs += ` stroke="currentColor"`;
      }

      return `<${name}${attrs}${selfClose}>`;
    }
  );

  return out;
}

/** Sanitize + line-drawing presentation for chat / tool results. */
export function prepareSvgForChat(content: string): string {
  return stylizeSvgAsLineDrawing(sanitizeSvg(content));
}

/**
 * Removes a tag (paired or self-closed), content included, case-insensitively.
 * Applied until the output is stable, so nested or split-up tags can't
 * reassemble into a live element after one removal pass (e.g.
 * `<scri<script>x</script>pt>`); any orphaned open/close tags left behind by
 * malformed nesting are then removed on their own, which downgrades their
 * former content to inert text.
 */
function stripElement(svg: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const selfClosed = new RegExp(`<${tag}\\b[^>]*/>`, "gi");
  let prev: string;
  do {
    prev = svg;
    svg = svg.replace(paired, "").replace(selfClosed, "");
  } while (svg !== prev);
  return svg
    .replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "")
    .replace(new RegExp(`<\\/${tag}\\s*>`, "gi"), "");
}

/**
 * Decodes numeric character references and strips whitespace/control
 * characters, so entity-encoded or split-up schemes (`jav&#x61;script:`,
 * `java\nscript:`) can't slip past the value tests below. Test-only — the
 * attribute keeps its original text when it survives.
 */
function decodeForTest(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    // eslint-disable-next-line no-control-regex
    .replace(/[\s\u0000-\u001f]+/g, "");
}

/** One attribute: name = "double" | 'single' | unquoted. */
const ATTR_RE = /([^\s=<>"'/]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

/**
 * Scrubs the attributes of a single `<tag ...>` span: drops `on*` event
 * handlers, anything carrying a `javascript:` URI, and external
 * href/xlink:href targets — keeping `#fragment` internal refs and
 * `data:image/*` URIs. Runs on tag spans only, so attribute-shaped prose in
 * text content is never touched.
 */
function sanitizeTag(tag: string): string {
  return tag.replace(ATTR_RE, (match, name: string, rawValue: string) => {
    const value = rawValue.replace(/^["']|["']$/g, "");
    const decoded = decodeForTest(value);
    if (/^on/i.test(name)) return "";
    if (/javascript:/i.test(decoded)) return "";
    if (/^(?:xlink:)?href$/i.test(name)) {
      if (/^(https?:)?\/\//i.test(decoded)) return "";
      if (/^data:/i.test(decoded)) {
        return /^data:image\//i.test(decoded) ? match : "";
      }
    }
    return match;
  });
}

/**
 * Sanitizes untrusted SVG markup for inline rendering. Throws when the
 * content doesn't look like an SVG document at all; otherwise strips the
 * classes of markup that could execute script or reach the network:
 * `<script>`/`<foreignObject>` (and a few other elements, defensively),
 * `on*` event-handler attributes, `javascript:` URIs in any attribute, and
 * external `href`/`xlink:href` targets.
 */
export function sanitizeSvg(content: string): string {
  const extracted = extractSvgMarkup(content);
  if (!looksLikeSvg(extracted)) {
    throw new Error("Not an SVG document.");
  }

  let svg = extracted;

  // Element stripping first (repeated until stable inside stripElement),
  // then per-tag attribute scrubbing over every remaining tag span.
  for (const tag of DANGEROUS_ELEMENTS) {
    svg = stripElement(svg, tag);
  }
  // Quote-aware tag spans: a ">" inside a quoted attribute value (e.g. a
  // data: URI carrying markup) must not terminate the tag early.
  svg = svg.replace(
    /<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g,
    sanitizeTag
  );

  return normalizeSvgForImage(svg);
}

/** Encodes SVG markup as a `data:image/svg+xml` URL, for use in <img src>. */
export function svgToDataUrl(svg: string): string {
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(normalizeSvgForImage(svg))
  );
}

/**
 * Single precompiled, case-insensitive, word-boundary regex over the
 * vocabulary that signals the user wants a visual — used to gate the
 * `svg_render` tool on for a turn even when it wasn't explicitly toggled.
 */
const VISUAL_INTENT_RE = new RegExp(
  "\\b(" +
    [
      "visual",
      "visuals",
      "visually",
      "visualize",
      "visualise",
      "visualization",
      "diagram",
      "diagrams",
      "draw",
      "drawing",
      "sketch",
      "illustrate",
      "illustration",
      "chart",
      "charts",
      "graph",
      "graphs",
      "graphic",
      // "figure out" is the common non-visual idiom; require it standalone.
      "figure(?!\\s+out)",
      "flowchart",
      "infographic",
      "schematic",
      "plot",
      "picture",
      "image",
      "show me",
    ].join("|") +
    ")\\b",
  "i"
);

/** Whether `text` expresses intent for a visual (diagram, chart, sketch, ...). */
export function detectVisualIntent(text: string): boolean {
  return VISUAL_INTENT_RE.test(text);
}

/**
 * Drawing doctrine for `svg_render`, appended whenever the tool is available
 * (it is foundational — every turn). Keep this short.
 */
export const SVG_DRAWING_RULES = `Inline sketch rules (\`svg_render\` — always available):
- Use freely for small drawings that support the topic (flows, geometry, icons, schematics). Reference the sketch naturally in your reply; do not paste the SVG source as text.
- Never use svg_render for interactive apps, long documents, full programs, or anything the user will iterate on as a deliverable — those go in the \`diagram\` artifact tool.
- Transparent line art only: fill='none', stroke='currentColor', no background rects or solid color blocks. Complete standalone <svg> with a viewBox; no scripts or external references.
- Layered construction: structural/skeletal lines first (proportions, major axes, bounding volumes), then detail.
- Geometric restraint: prefer technical diagrams, icons, and geometric compositions. For complex figurative subjects, keep it simple and stiff rather than fake fluency — diagram the idea, don't illustrate the subject.`;
