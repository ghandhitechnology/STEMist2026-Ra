/**
 * lib/markdown-math.ts — LaTeX normalisation for the chat's Markdown renderer.
 *
 * Models emit math in \( … \) / \[ … \] as often as $ … $ / $$ … $$, but
 * remark-math only parses the dollar forms. Prose segments are rewritten;
 * code is left untouched — the text splits on fenced blocks and closed
 * inline code, and an unclosed fence (mid-stream) swallows the tail so
 * streamed code is never rewritten.
 *
 * Inside math spans, programmer notation is rewritten to the LaTeX
 * operators KaTeX expects: `/=`, `=/=`, and `!=` become \neq, and `>=` /
 * `<=` become \ge / \le. Only inside math: in prose and code these are
 * real operators (divide-assign in Python/C, inequality in Haskell).
 */

const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

/** Dollar-delimited math spans; unclosed spans (mid-stream) don't match. */
const MATH_SPAN = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;

function fixMathOperators(span: string): string {
  return span
    .replace(/=\/=|\/=|!=/g, "\\neq ")
    .replace(/(?<![<>=\\])>=(?!=)/g, "\\ge ")
    .replace(/(?<![<>=\\])<=(?!=)/g, "\\le ");
}

/** Anything the rewrites below could act on; most turns skip the work. */
const NEEDS_NORMALIZING = /\\\(|\\\[|\/=|!=|>=|<=/;

export function normalizeMathDelimiters(content: string): string {
  if (!NEEDS_NORMALIZING.test(content)) return content;
  return content
    .split(CODE_SEGMENT)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body}$$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body}$`)
        .replace(MATH_SPAN, fixMathOperators);
    })
    .join("");
}
