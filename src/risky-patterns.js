// The patterns the hub scans a published source for, run against the compiled
// output so the same feedback lands before upload.

const MAX_WARNINGS = 50;

const PATTERNS = [
  {
    code: "fetch",
    // A member call is left alone: Scratch.fetch() is the sandboxed wrapper
    // TurboWarp asks extensions to use, so flagging it would be noise.
    match: /(?<!\.)\bfetch\s*\(/g,
    message: "Calls fetch() directly; prefer Scratch.fetch().",
  },
  {
    code: "eval",
    match: /\beval\s*\(/g,
    message: "Runs a string as code with eval().",
  },
  {
    code: "new-function",
    match: /\bnew\s+Function\b/g,
    message: "Builds a function from a string with new Function().",
  },
  {
    code: "xmlhttprequest",
    match: /\bXMLHttpRequest\b/g,
    message: "Opens a raw XMLHttpRequest instead of using Scratch.fetch().",
  },
  {
    code: "insecure-http",
    match: /http:\/\//g,
    message: "References a plaintext http:// URL.",
  },
];

// Matching the whole text lets `\s` span a newline, so an expression broken
// across lines (`fetch(\n...)`, `new\nFunction`) is still caught. One hit per
// line per pattern, capped so a minified bundle can't flood the terminal.
export function riskyPatternWarnings(code) {
  const found = [];
  for (let order = 0; order < PATTERNS.length; order++) {
    const pattern = PATTERNS[order];
    let line = 1;
    let nextNewline = code.indexOf("\n");
    let lastLine = 0;
    let added = 0;
    for (const match of code.matchAll(pattern.match)) {
      while (nextNewline !== -1 && match.index > nextNewline) {
        line += 1;
        nextNewline = code.indexOf("\n", nextNewline + 1);
      }
      if (line === lastLine) continue;
      lastLine = line;
      found.push({ order, line, message: pattern.message });
      if (++added >= MAX_WARNINGS) break;
    }
  }
  found.sort((a, b) => a.line - b.line || a.order - b.order);
  return found
    .slice(0, MAX_WARNINGS)
    .map((warning) => `Compiled output line ${warning.line}: ${warning.message}`);
}
