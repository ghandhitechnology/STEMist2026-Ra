/**
 * lib/diagram-runtime.ts — turns diagram source into a self-contained HTML
 * document for the sandboxed preview iframe (and the standalone /raw route).
 *
 * Runnable kinds:
 *   html  — the source is already a document (or a fragment we wrap)
 *   svg   — centred on a neutral board
 *   react — JSX/TSX compiled in-browser by Babel standalone, mounted with
 *           React 19 resolved through an import map
 *
 * Dependencies load from a CDN because React 19 ships no UMD build; the base
 * is a single constant so a future cloud deployment can point it at a
 * self-hosted mirror. The iframe runs WITHOUT `allow-same-origin`, so this
 * code cannot reach the host page, its storage, or its cookies.
 */

import type { DiagramKind } from "./types";

/** Swap these for self-hosted mirrors when this moves off localhost. */
export const DIAGRAM_CDN = "https://esm.sh";
export const TAILWIND_CDN = "https://cdn.tailwindcss.com";
/**
 * Babel standalone must come from a raw-file CDN, not esm.sh: esm.sh rewrites
 * packages into ES modules, and this one is loaded as a classic script (it has
 * to run before the `text/babel` block is parsed).
 */
export const BABEL_CDN =
  "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js";

/** postMessage namespace shared with the host diagram panel. */
export const DIAGRAM_MESSAGE_SOURCE = "rauchat:diagram";

/** Sandbox grants: everything the preview needs, minus same-origin access. */
export const DIAGRAM_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock allow-presentation";

/** Kinds that run as a live document rather than as text/prose. */
export function isRunnable(kind: DiagramKind): boolean {
  return kind === "html" || kind === "react" || kind === "svg";
}

const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #16161a;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
  }
  #root { min-height: 100vh; }
`;

/**
 * Surfaces runtime failures inside the frame — without this a thrown error
 * during mount leaves a blank white panel with no explanation.
 */
const ERROR_OVERLAY = `
<script>
(function () {
  function show(title, detail) {
    var el = document.getElementById("__diagram_error");
    if (!el) {
      el = document.createElement("div");
      el.id = "__diagram_error";
      el.setAttribute("style", [
        "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483647",
        "max-height:55vh", "overflow:auto", "margin:0",
        "padding:12px 14px", "background:#2b1113", "color:#ffb4ab",
        "border-top:1px solid #7f2c26", "white-space:pre-wrap",
        "font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace"
      ].join(";"));
      document.body.appendChild(el);
    }
    el.textContent = title + (detail ? "\\n\\n" + detail : "");
  }
  window.addEventListener("error", function (e) {
    if (e && e.message) show(e.message, e.error && e.error.stack ? e.error.stack : "");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    show("Unhandled promise rejection", r && r.stack ? r.stack : String(r));
  });
})();
</script>`.trim();

/**
 * Gives every runnable artifact the same opt-in interaction contract while it
 * remains isolated in its opaque origin.
 *
 * - Canvas and `[data-keyboard-control]` elements become focusable.
 * - Custom controls receive a bubbling `diagramcontrol` event for each key;
 *   Enter/Space also click non-native controls.
 * - `[data-pointer-lock]` requests pointer lock from the user's click.
 * - `window.RauArtifact` exposes focus/pointer-lock helpers to authored code.
 * - State is reported to the host through postMessage only.
 */
const INTERACTION_BRIDGE = `
<script>
(function () {
  var SOURCE = "${DIAGRAM_MESSAGE_SOURCE}";

  function post(type, detail) {
    if (window.parent === window) return;
    window.parent.postMessage({ source: SOURCE, type: type, detail: detail || null }, "*");
  }

  function closest(element, selector) {
    return element && element.closest ? element.closest(selector) : null;
  }

  function prepare(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var controls = scope.querySelectorAll(
      "canvas:not([tabindex]), [role='application']:not([tabindex]), " +
      "[data-keyboard-control]:not([tabindex]), [data-pointer-lock]:not([tabindex])"
    );
    controls.forEach(function (element) {
      element.setAttribute("tabindex", "0");
      if (element.tagName === "CANVAS" && !element.hasAttribute("role")) {
        element.setAttribute("role", "application");
      }
    });
  }

  function focusArtifact() {
    var target = document.querySelector(
      "[data-keyboard-control], [role='application'], canvas, [data-pointer-lock]"
    ) || document.body;
    if (target && target.focus) target.focus({ preventScroll: true });
  }

  function requestPointerLock(target) {
    var element = target || document.querySelector("[data-pointer-lock], canvas");
    if (!element || !element.requestPointerLock) {
      post("pointerlockerror", { message: "This artifact has no pointer-lock target." });
      return;
    }
    try {
      var request = element.requestPointerLock();
      if (request && request.catch) {
        request.catch(function (error) {
          post("pointerlockerror", { message: String(error && error.message || error) });
        });
      }
    } catch (error) {
      post("pointerlockerror", { message: String(error && error.message || error) });
    }
  }

  document.addEventListener("pointerdown", function (event) {
    var target = closest(
      event.target,
      "[data-keyboard-control], [role='application'], canvas, [data-pointer-lock]"
    );
    if (target && target.focus) target.focus({ preventScroll: true });
    else if (document.body && document.body.focus) {
      document.body.focus({ preventScroll: true });
    }
  }, true);

  document.addEventListener("click", function (event) {
    var target = closest(event.target, "[data-pointer-lock]");
    if (target) requestPointerLock(target);
  }, true);

  document.addEventListener("keydown", function (event) {
    var control = closest(event.target, "[data-keyboard-control]");
    if (control) {
      control.dispatchEvent(new CustomEvent("diagramcontrol", {
        bubbles: true,
        detail: {
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey
        }
      }));
      var nativeControl = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(control.tagName);
      if (!nativeControl && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        if (control.click) control.click();
      }
    }
    if (event.key === "Escape") post("escape");
  }, true);

  document.addEventListener("focusin", function () { post("focus", { active: true }); });
  document.addEventListener("focusout", function () {
    setTimeout(function () {
      post("focus", { active: document.hasFocus() });
    }, 0);
  });
  document.addEventListener("pointerlockchange", function () {
    post("pointerlock", { active: Boolean(document.pointerLockElement) });
  });
  document.addEventListener("pointerlockerror", function () {
    post("pointerlockerror", { message: "Pointer lock was denied by the browser." });
  });

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === "focus") focusArtifact();
    if (data.type === "request-pointer-lock") requestPointerLock();
    if (data.type === "exit-pointer-lock" && document.exitPointerLock) {
      document.exitPointerLock();
    }
  });

  window.RauArtifact = Object.freeze({
    focus: focusArtifact,
    requestPointerLock: requestPointerLock,
    exitPointerLock: function () {
      if (document.exitPointerLock) document.exitPointerLock();
    },
    isPointerLocked: function () { return Boolean(document.pointerLockElement); }
  });

  function ready() {
    if (document.body && !document.body.hasAttribute("tabindex")) {
      document.body.setAttribute("tabindex", "-1");
    }
    prepare(document);
    if (window.MutationObserver) {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (node && node.nodeType === 1) {
              if (node.matches && node.matches(
                "canvas, [role='application'], [data-keyboard-control], [data-pointer-lock]"
              ) && !node.hasAttribute("tabindex")) {
                node.setAttribute("tabindex", "0");
              }
              prepare(node);
            }
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
    post("ready", { pointerLockSupported: "pointerLockElement" in document });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();
</script>`.trim();

function escapeForScript(code: string): string {
  // Only `</script` can terminate the block early; nothing else needs escaping
  // because the body is inlined verbatim into a <script> element.
  return code.replace(/<\/script/gi, "<\\/script");
}

/* ------------------------------------------------------------------
   React
   ------------------------------------------------------------------ */

/** Matches a whole top-level import statement, including side-effect imports. */
const IMPORT_RE =
  /^[ \t]*import\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["'][ \t]*;?[ \t]*$/gm;

type ReactSource = {
  /** User code with imports and export keywords removed. */
  body: string;
  /** Identifier holding the component to mount, if one could be determined. */
  componentName: string | null;
  /** Import statements, hoisted to the top of the generated module. */
  imports: string[];
  /** True when the user's own imports already bind `React`. */
  bindsReact: boolean;
  /** Bare package specifiers that need an import-map entry. */
  packages: string[];
};

/**
 * Prepares model-authored TSX for execution as an inline module.
 *
 * Inline modules cannot be imported, so `export default` is rewritten into a
 * named binding the bootstrap can mount. Imports are hoisted verbatim (the
 * import map resolves them) rather than re-declared, which is what makes a
 * user's own `import React from "react"` safe.
 */
function parseReactSource(code: string): ReactSource {
  const imports: string[] = [];
  const packages: string[] = [];
  let bindsReact = false;

  let body = code.replace(IMPORT_RE, (statement, specifier: string) => {
    imports.push(statement.trim());
    if (/^react$/.test(specifier) && /import\s+React\b/.test(statement)) {
      bindsReact = true;
    }
    // Relative paths cannot resolve in a standalone frame; drop them so the
    // error surfaces as a missing component rather than a failed fetch.
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      packages.push(specifier);
    }
    return "";
  });

  let componentName: string | null = null;

  // `export default function Name` / `export default class Name`
  const namedDefault = /^[ \t]*export\s+default\s+(function|class)\s+([A-Za-z_$][\w$]*)/m.exec(
    body
  );
  if (namedDefault) {
    componentName = namedDefault[2];
    body = body.replace(namedDefault[0], `${namedDefault[1]} ${namedDefault[2]}`);
  } else {
    // `export default Identifier;`
    const identDefault = /^[ \t]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$/m.exec(
      body
    );
    if (identDefault) {
      componentName = identDefault[1];
      body = body.replace(identDefault[0], "");
    } else if (/^[ \t]*export\s+default\s+/m.test(body)) {
      // Anonymous: `export default () => …`, `export default class {…}`
      componentName = "__DiagramDefault";
      body = body.replace(
        /^[ \t]*export\s+default\s+/m,
        "const __DiagramDefault = "
      );
    }
  }

  // Named exports are meaningless here, but the keyword is a syntax error
  // outside a module's top level once we inline everything.
  body = body.replace(
    /^[ \t]*export\s+(?=(const|let|var|function|class)\s)/gm,
    ""
  );
  body = body.replace(/^[ \t]*export\s*\{[^}]*\}[ \t]*;?[ \t]*$/gm, "");

  // No default export — fall back to the last top-level PascalCase component,
  // which is conventionally the one that composes the others.
  if (!componentName) {
    const declarations = [
      ...body.matchAll(
        /^[ \t]*(?:function|const|let|var|class)\s+([A-Z][\w$]*)/gm
      ),
    ].map((m) => m[1]);
    componentName =
      declarations.find((n) => n === "App") ??
      declarations[declarations.length - 1] ??
      null;
  }

  return { body, componentName, imports, bindsReact, packages };
}

/**
 * Import map for React plus any other bare package the diagram imports, so
 * `import { motion } from "framer-motion"` resolves instead of throwing.
 */
function buildImportMap(packages: string[]): string {
  const imports: Record<string, string> = {
    react: `${DIAGRAM_CDN}/react@19`,
    "react/": `${DIAGRAM_CDN}/react@19/`,
    "react-dom": `${DIAGRAM_CDN}/react-dom@19`,
    "react-dom/": `${DIAGRAM_CDN}/react-dom@19/`,
    "react-dom/client": `${DIAGRAM_CDN}/react-dom@19/client`,
    "react/jsx-runtime": `${DIAGRAM_CDN}/react@19/jsx-runtime`,
  };
  for (const pkg of packages) {
    if (imports[pkg]) continue;
    // Pin peer React so a package cannot pull a second copy of it.
    imports[pkg] = `${DIAGRAM_CDN}/${pkg}?external=react,react-dom`;
  }
  return JSON.stringify({ imports });
}

function reactDocument(code: string, title: string): string {
  const { body, componentName, imports, bindsReact, packages } =
    parseReactSource(code);

  // Only bind React ourselves when the source does not — the classic JSX
  // transform needs `React` in scope, but redeclaring it would be a
  // duplicate-binding syntax error.
  const reactShim = bindsReact
    ? ""
    : `import * as __ReactNS from "react";
const React = __ReactNS.default ?? __ReactNS;
const { useState, useEffect, useRef, useMemo, useCallback, useReducer,
        useContext, useLayoutEffect, createContext, Fragment, memo } = React;`;

  const mount = componentName
    ? `if (typeof ${componentName} === "undefined" || !${componentName}) {
  throw new Error("Component ${componentName} is not defined.");
}
__createRoot(document.getElementById("root")).render(
  __ReactForMount.createElement(${componentName})
);`
    : `throw new Error(
  "No component found — export a default component from the diagram."
);`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script src="${TAILWIND_CDN}"></script>
<script type="importmap">${buildImportMap(packages)}</script>
<script src="${BABEL_CDN}"></script>
<script>
// The bare "typescript" preset assumes .ts, so a TSX generic like
// useState<string|null>() parses as a comparison and blows up at runtime with
// "string is not defined". Registering the preset with isTSX makes the type
// annotations strip correctly. Runs before Babel's DOMContentLoaded pass.
Babel.registerPreset("diagram-tsx", {
  presets: [
    [Babel.availablePresets["react"]],
    [Babel.availablePresets["typescript"], { isTSX: true, allExtensions: true }]
  ]
});
</script>
<style>${BASE_STYLES}</style>
</head>
<body>
<div id="root"></div>
${ERROR_OVERLAY}
${INTERACTION_BRIDGE}
<script type="text/babel" data-type="module" data-presets="diagram-tsx">
import * as __ReactForMount from "react";
import { createRoot as __createRoot } from "react-dom/client";
${escapeForScript(imports.join("\n"))}
${reactShim}

${escapeForScript(body)}

${mount}
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------
   HTML / SVG
   ------------------------------------------------------------------ */

function htmlDocument(code: string, title: string): string {
  const isFullDocument = /<html[\s>]/i.test(code) || /<!doctype/i.test(code);
  if (isFullDocument) {
    // Inject runtime helpers just before </body>. Some generated documents
    // omit the closing tag; appending is still parsed into the body by HTML.
    const additions = `${ERROR_OVERLAY}\n${INTERACTION_BRIDGE}`;
    return /<\/body>/i.test(code)
      ? code.replace(/<\/body>/i, `${additions}</body>`)
      : `${code}\n${additions}`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script src="${TAILWIND_CDN}"></script>
<style>${BASE_STYLES}</style>
</head>
<body>
${code}
${ERROR_OVERLAY}
${INTERACTION_BRIDGE}
</body>
</html>`;
}

function svgDocument(code: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${BASE_STYLES}
body { display:flex; align-items:center; justify-content:center; padding:24px;
       background:#f6f6f7; }
svg { max-width:100%; height:auto; }
</style>
</head>
<body>
${code}
${ERROR_OVERLAY}
${INTERACTION_BRIDGE}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The complete document for a runnable diagram. Non-runnable kinds return
 * an empty string — callers render those as prose or code instead.
 */
export function buildDiagramDocument(
  kind: DiagramKind,
  content: string,
  title = "Diagram"
): string {
  switch (kind) {
    case "react":
      return reactDocument(content, title);
    case "html":
      return htmlDocument(content, title);
    case "svg":
      return svgDocument(content, title);
    default:
      return "";
  }
}

/** File extension used when downloading a diagram. */
export function extensionFor(kind: DiagramKind, language?: string): string {
  switch (kind) {
    case "html":
      return "html";
    case "react":
      return "tsx";
    case "svg":
      return "svg";
    case "markdown":
      return "md";
    case "code":
      return (language || "txt").toLowerCase().replace(/[^a-z0-9]/g, "") || "txt";
  }
}
