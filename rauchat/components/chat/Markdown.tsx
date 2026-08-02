"use client";

/**
 * components/chat/Markdown.tsx
 *
 * Transcript prose renderer (DESIGN.md §4.7): react-markdown + remark-gfm,
 * 68ch measure, styled code blocks with a copy button, wrapped tables.
 *
 * The streaming caret (§4.8) is attached by the caller via `className`
 * (see MessageItem) — it is a CSS ::after on the last block, so it always
 * lands at the end of the last text node without mutating the markdown.
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { normalizeMathDelimiters } from "@/lib/markdown-math";
import styles from "./chat.module.css";
import { IconCheck, IconCopy } from "./icons";

/* ------------------------------------------------------------------
   Minimal syntax tokenizer.
   Monochrome-leaning palette per §4.7; one accent (function calls).
   Only runs for known languages — unknown blocks render as plain mono,
   which is calmer than mis-colouring prose.
   ------------------------------------------------------------------ */

const HASH_COMMENT_LANGS = new Set([
  "py", "python", "bash", "sh", "shell", "zsh", "yaml", "yml", "toml", "rb", "ruby", "r",
]);

const KNOWN_LANGS = new Set([
  "ts", "tsx", "typescript", "js", "jsx", "javascript", "mjs", "cjs", "json", "jsonc",
  "py", "python", "bash", "sh", "shell", "zsh", "go", "rust", "rs", "java", "c", "cpp",
  "csharp", "cs", "sql", "css", "scss", "yaml", "yml", "toml", "rb", "ruby", "php", "swift", "kotlin",
]);

const KEYWORDS = new Set([
  // js / ts
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "new", "class", "extends", "implements", "interface", "type",
  "enum", "import", "export", "from", "as", "default", "async", "await", "yield", "try",
  "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "delete", "void", "this",
  "super", "static", "public", "private", "protected", "readonly", "abstract", "declare",
  "namespace", "satisfies", "keyof", "infer", "true", "false", "null", "undefined",
  // python
  "def", "lambda", "pass", "raise", "with", "elif", "None", "True", "False", "not", "and",
  "or", "is", "global", "nonlocal", "assert", "del", "self",
  // go / rust / c-family
  "func", "struct", "impl", "trait", "mut", "fn", "pub", "use", "mod", "match", "loop",
  "package", "defer", "go", "chan", "select", "range", "int", "string", "bool", "float",
  "double", "char", "unsigned", "sizeof", "include", "define", "nil",
  // sql
  "SELECT", "FROM", "WHERE", "JOIN", "GROUP", "ORDER", "BY", "INSERT", "UPDATE", "DELETE",
  "CREATE", "TABLE", "ALTER", "DROP", "LIMIT", "VALUES", "SET", "INTO", "ON", "AS",
]);

type Token = { cls: string | null; value: string };

const regexCache = new Map<boolean, RegExp>();

function tokenizerFor(hashComments: boolean): RegExp {
  const cached = regexCache.get(hashComments);
  if (cached) return cached;
  const comment = hashComments
    ? String.raw`#[^\n]*|\/\*[\s\S]*?\*\/`
    : String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*|--[^\n]*`;
  const re = new RegExp(
    "(" + comment + ")" +
      String.raw`|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|` + "`(?:\\\\.|[^`\\\\])*`)" +
      String.raw`|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)` +
      String.raw`|([A-Za-z_$][\w$]*)(?=\s*\()` +
      String.raw`|([A-Za-z_$][\w$]*)` +
      String.raw`|([{}()[\].,;:+\-*/%<>=!&|^~?]+)`,
    "g"
  );
  regexCache.set(hashComments, re);
  return re;
}

function tokenize(code: string, language: string): Token[] {
  const lang = language.toLowerCase();
  if (!KNOWN_LANGS.has(lang)) return [{ cls: null, value: code }];

  const re = tokenizerFor(HASH_COMMENT_LANGS.has(lang));
  const tokens: Token[] = [];
  let last = 0;
  re.lastIndex = 0;

  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    if (m.index > last) tokens.push({ cls: null, value: code.slice(last, m.index) });
    if (m[1]) tokens.push({ cls: styles.tokComment, value: m[1] });
    else if (m[2]) tokens.push({ cls: styles.tokString, value: m[2] });
    else if (m[3]) tokens.push({ cls: styles.tokNumber, value: m[3] });
    else if (m[4]) {
      tokens.push({
        cls: KEYWORDS.has(m[4]) ? styles.tokKeyword : styles.tokFunction,
        value: m[4],
      });
    } else if (m[5]) {
      tokens.push({ cls: KEYWORDS.has(m[5]) ? styles.tokKeyword : null, value: m[5] });
    } else if (m[6]) tokens.push({ cls: styles.tokPunct, value: m[6] });
    last = m.index + m[0].length;
  }
  if (last < code.length) tokens.push({ cls: null, value: code.slice(last) });
  return tokens;
}

/* ------------------------------------------------------------------
   Copy affordance — label swaps to "Copied" for 1400ms (§4.7)
   ------------------------------------------------------------------ */

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    };
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(() => undefined);
    }
  }, []);

  return [copied, copy];
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [copied, copy] = useCopy();
  const tokens = useMemo(() => tokenize(code, language), [code, language]);

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language || "text"}</span>
        <button
          type="button"
          className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ""}`}
          onClick={() => copy(code)}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className={styles.codeScroll}>
        <pre className={styles.codePre}>
          <code>
            {tokens.map((t, i) =>
              t.cls ? (
                <span key={i} className={t.cls}>
                  {t.value}
                </span>
              ) : (
                <span key={i}>{t.value}</span>
              )
            )}
          </code>
        </pre>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------
   react-markdown component map
   ------------------------------------------------------------------ */

function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return nodeToText(props?.children);
  }
  return "";
}

/**
 * `pre` owns fenced blocks: it extracts the language + raw text from the
 * child <code> element and renders CodeBlock, so the inline `code` override
 * is only ever used for genuinely inline code.
 */
const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    let language = "";
    let code = "";
    if (child && typeof child === "object" && "props" in child) {
      const props = (child as { props?: { className?: string; children?: ReactNode } }).props;
      language = /language-([\w+-]+)/.exec(props?.className ?? "")?.[1] ?? "";
      code = nodeToText(props?.children).replace(/\n$/, "");
    } else {
      code = nodeToText(children);
    }
    return <CodeBlock code={code} language={language} />;
  },

  code({ node, className, children, ...rest }) {
    void node;
    return (
      <code {...rest} className={styles.inlineCode}>
        {children}
      </code>
    );
  },

  table({ node, children, ...rest }) {
    void node;
    return (
      <div className={styles.tableWrap}>
        <table {...rest}>{children}</table>
      </div>
    );
  },

  a({ node, children, href, ...rest }) {
    void node;
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/* ------------------------------------------------------------------
   Streaming word fade (§4.8)

   While a turn streams, every word is wrapped in a span that fades in.
   React reconciles the spans positionally, so words that already rendered
   keep their DOM node — their animation has already played — and only
   spans appended at the tail animate. When streaming ends the plain
   component map takes over; the text is identical, so nothing shifts.
   ------------------------------------------------------------------ */

function splitFadeSpans(text: string): ReactNode[] {
  return text.split(/(\s+)/).map((part, i) =>
    part && !/^\s+$/.test(part) ? (
      <span key={i} className={styles.fadeWord}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

function fadeWords(children: ReactNode): ReactNode {
  if (typeof children === "string") return splitFadeSpans(children);
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? (
        <Fragment key={i}>{splitFadeSpans(child)}</Fragment>
      ) : (
        child
      )
    );
  }
  return children;
}

/** Elements whose direct text children fade in word-by-word. Code blocks
 *  and inline code are deliberately excluded — tokenised code keeps its own
 *  rendering, and fading fragments of code reads as flicker, not flow. */
const FADE_TAGS = [
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "del",
  "td",
  "th",
] as const;

const streamingComponents: Components = {
  ...components,
  ...Object.fromEntries(
    FADE_TAGS.map((Tag) => [
      Tag,
      // eslint-disable-next-line react/display-name
      ({ node, children, ...rest }: { node?: unknown; children?: ReactNode }) => {
        void node;
        const Element = Tag as React.ElementType;
        return <Element {...rest}>{fadeWords(children)}</Element>;
      },
    ])
  ),
};

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: import("unified").PluggableList = [
  [
    rehypeKatex,
    {
      errorColor: "var(--rau-danger)",
      strict: false,
      // KaTeX has no real ≠ glyph: stock \neq overlays a combining slash on
      // "=" off-centre, and falling back to a raw U+2260 char picks up CJK
      // system fonts that draw the stroke vertically. Instead the "=" is
      // tagged with a class and the diagonal is drawn in CSS (.rau-neq in
      // chat.module.css) — font-independent. \ne and a literal ≠ both
      // expand through \neq, so this also covers the /= rewrite in
      // lib/markdown-math.
      macros: { "\\neq": "\\mathrel{\\htmlClass{rau-neq}{=}}" },
      // \htmlClass needs trust; nothing else (\href, \htmlStyle…) gets it.
      trust: (ctx: { command: string }) => ctx.command === "\\htmlClass",
    },
  ],
];

export type MarkdownProps = {
  content: string;
  /** Extra class on the prose container (used for the streaming caret). */
  className?: string;
  /** True while this turn is streaming — enables the word-by-word fade. */
  streaming?: boolean;
};

/**
 * Memoised so a re-render of the surrounding turn does not re-parse markdown;
 * during streaming only the last message's `content` changes.
 */
export const Markdown = memo(function Markdown({
  content,
  className,
  streaming = false,
}: MarkdownProps) {
  const normalized = useMemo(() => normalizeMathDelimiters(content), [content]);
  return (
    <div className={className ? `${styles.prose} ${className}` : styles.prose}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={streaming ? streamingComponents : components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
