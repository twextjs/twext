import { parse } from "espree";
import { analyze } from "eslint-scope";
import globals from "globals";

export const RUNTIME_GLOBALS = new Set([
  ...Object.keys(globals.es2027),
  ...Object.keys(globals.browser),
  "undefined",
  "NaN",
  "Infinity",
  "globalThis",
  "arguments",
  "Scratch",
]);

const PARSE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", range: true };
const ANALYZE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", ignoreEval: true };

function analyzeSource(text) {
  const ast = parse(text, PARSE_OPTIONS);
  return analyze(ast, ANALYZE_OPTIONS);
}

export function handlerFreeVariables(source) {
  let scopeManager;
  try {
    scopeManager = analyzeSource(`(${source}\n)`);
  } catch {
    scopeManager = analyzeSource(`({${source}\n})`);
  }
  return new Set(scopeManager.globalScope.through.map((ref) => ref.identifier.name));
}

export function programFreeVariables(source) {
  const scopeManager = analyzeSource(source);
  return new Set(scopeManager.globalScope.through.map((ref) => ref.identifier.name));
}

export function topLevelDeclarations(source) {
  const scopeManager = analyzeSource(source);
  return new Set(scopeManager.globalScope.variables.map((variable) => variable.name));
}
