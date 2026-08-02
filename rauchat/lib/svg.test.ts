import { describe, expect, it } from "vitest";
import {
  detectVisualIntent,
  extractSvgMarkup,
  looksLikeSvg,
  normalizeSvgForImage,
  prepareSvgForChat,
  sanitizeSvg,
  stylizeSvgAsLineDrawing,
  svgToDataUrl,
} from "./svg";

describe("looksLikeSvg", () => {
  it("accepts a plain svg document", () => {
    expect(looksLikeSvg('<svg viewBox="0 0 10 10"><rect /></svg>')).toBe(true);
  });

  it("accepts an svg preceded by an xml declaration and doctype", () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg viewBox="0 0 10 10"><circle r="1" /></svg>`;
    expect(looksLikeSvg(content)).toBe(true);
  });

  it("rejects content that is not svg", () => {
    expect(looksLikeSvg("<div>not svg</div>")).toBe(false);
  });

  it("rejects an unclosed svg-looking tag name", () => {
    expect(looksLikeSvg("<svgfoo></svgfoo>")).toBe(false);
  });

  it("rejects svg markup missing a closing tag", () => {
    expect(looksLikeSvg('<svg viewBox="0 0 10 10"><rect />')).toBe(false);
  });
});

describe("extractSvgMarkup", () => {
  it("unwraps markdown-fenced svg", () => {
    const fenced =
      '```svg\n<svg viewBox="0 0 10 10"><circle r="1" /></svg>\n```';
    expect(extractSvgMarkup(fenced)).toBe(
      '<svg viewBox="0 0 10 10"><circle r="1" /></svg>'
    );
  });

  it("pulls the first svg out of surrounding prose", () => {
    const prose =
      'Here you go:\n<svg viewBox="0 0 10 10"><rect /></svg>\nEnjoy.';
    expect(extractSvgMarkup(prose)).toBe(
      '<svg viewBox="0 0 10 10"><rect /></svg>'
    );
  });
});

describe("normalizeSvgForImage", () => {
  it("adds xmlns and concrete size from viewBox", () => {
    const out = normalizeSvgForImage(
      '<svg viewBox="0 0 400 300"><rect width="400" height="300" /></svg>'
    );
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="400"');
    expect(out).toContain('height="300"');
  });

  it("replaces percentage width/height with viewBox size", () => {
    const out = normalizeSvgForImage(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60" width="100%" height="100%"><circle r="1" /></svg>'
    );
    expect(out).toContain('width="80"');
    expect(out).toContain('height="60"');
    expect(out).not.toContain("100%");
  });
});

describe("sanitizeSvg", () => {
  it("throws on non-svg content", () => {
    expect(() => sanitizeSvg("<div>hi</div>")).toThrow("Not an SVG document.");
  });

  it("accepts fenced svg from model output", () => {
    const clean = sanitizeSvg(
      '```svg\n<svg viewBox="0 0 10 10"><circle r="1" /></svg>\n```'
    );
    expect(clean).toContain("<circle");
    expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("preserves legitimate shapes and internal fragment refs", () => {
    const svg =
      '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10" fill="#000" /><use href="#dot" /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).toContain('<rect x="0" y="0" width="10" height="10" fill="#000" />');
    expect(clean).toContain('href="#dot"');
  });

  it("strips script elements and their content", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert(1)");
    expect(clean).toContain("<rect");
  });

  it("strips foreignObject elements and their content", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><foreignObject><body onload="evil()">hi</body></foreignObject><circle r="1" /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("evil()");
    expect(clean).toContain("<circle");
  });

  it("strips on* event-handler attributes", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><rect onclick="alert(1)" onmouseover=\'steal()\' width="5" /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toMatch(/on[a-z]+\s*=/i);
    expect(clean).toContain('width="5"');
  });

  it("strips attributes carrying a javascript: URI", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><a href="javascript:alert(1)"><rect /></a></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("javascript:");
  });

  it("removes external http(s) and protocol-relative href targets", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png" /><image xlink:href="//evil.example/y.png" /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("evil.example");
  });

  it("keeps data:image/* href but removes other data: URIs", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAAA" /><image href="data:text/html,<b>hi</b>" /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).toContain('href="data:image/png;base64,AAAA"');
    expect(clean).not.toContain("data:text/html");
  });

  it("does not let nested tags reassemble into a live script element", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><scri<script>x</script>pt>alert(1)</script></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("</script");
  });

  it("does not leak nested foreignObject tail content as live markup", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><foreignObject><foreignObject></foreignObject><img src="x" onerror="alert(1)"></foreignObject></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toMatch(/onerror\s*=/i);
  });

  it("strips unquoted event handlers, javascript: and external hrefs", () => {
    const svg =
      '<svg viewBox="0 0 10 10" onload=alert(1)><rect onclick=alert(2) /><a href=javascript:alert(3)><rect /></a><image href=https://evil.example/x.png /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toMatch(/on[a-z]+\s*=/i);
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("evil.example");
  });

  it("catches entity-encoded and whitespace-split javascript: schemes", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><a href="jav&#x61;script:alert(1)"><rect /></a><a href="java\nscript:alert(2)"><circle r="1" /></a></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toMatch(/href\s*=/i);
    expect(clean).toContain("<rect");
    expect(clean).toContain("<circle");
  });

  it("leaves attribute-shaped prose inside text content untouched", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><text>set x="javascript:foo" here</text></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).toContain('set x="javascript:foo" here');
  });

  it("strips iframe, embed, object, link, and meta elements", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><iframe src="https://evil.example"></iframe><embed src="x" /><object data="y"></object><link rel="x" /><meta charset="utf-8" /><rect /></svg>';
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<embed");
    expect(clean).not.toContain("<object");
    expect(clean).not.toContain("<link");
    expect(clean).not.toContain("<meta");
    expect(clean).toContain("<rect");
  });
});

describe("svgToDataUrl", () => {
  it("encodes svg markup as a data URL", () => {
    const url = svgToDataUrl("<svg></svg>");
    expect(url).toBe(
      "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    );
  });
});

describe("stylizeSvgAsLineDrawing", () => {
  it("sets transparent line-drawing defaults on the root", () => {
    const out = stylizeSvgAsLineDrawing(
      '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" /></svg>'
    );
    expect(out).toContain('fill="none"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('stroke-width="1.5"');
  });

  it("strips a white full-bleed backdrop rect and solid shape fills", () => {
    const out = stylizeSvgAsLineDrawing(
      '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#fff" /><rect x="10" y="10" width="20" height="20" fill="#e74c3c" /><text x="5" y="5" fill="#000">Hi</text></svg>'
    );
    expect(out).not.toContain('fill="#fff"');
    expect(out).not.toContain('fill="#e74c3c"');
    expect(out).toContain('fill="currentColor"');
    expect(out).toContain("<text");
  });
});

describe("prepareSvgForChat", () => {
  it("sanitizes and stylizes in one pass", () => {
    const out = prepareSvgForChat(
      '```svg\n<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><circle cx="5" cy="5" r="3" fill="black"/></svg>\n```'
    );
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).not.toContain("white");
    expect(out).not.toContain("black");
  });
});

describe("detectVisualIntent", () => {
  it.each([
    "can you draw me a diagram",
    "show me a chart of X",
    "visualize this",
  ])("detects intent in %j", (text) => {
    expect(detectVisualIntent(text)).toBe(true);
  });

  it.each([
    "what is the capital of France",
    "fix this bug",
  ])("finds no intent in %j", (text) => {
    expect(detectVisualIntent(text)).toBe(false);
  });
});
