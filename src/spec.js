import { NAMESPACE_PATTERN } from "./hub.js";
import { EXTENSION_ID_PATTERN } from "./validate.js";

// "id", "id@1.2.3", "ns/id", "@ns/id@latest" → { namespace?, id, version? }
export function parseSpec(spec) {
  let rest = spec;
  let version;
  const at = rest.lastIndexOf("@");
  if (at > 0) {
    version = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let namespace;
  let id = rest.startsWith("@") ? rest.slice(1) : rest;
  const slash = id.indexOf("/");
  if (slash >= 0) {
    namespace = id.slice(0, slash);
    id = id.slice(slash + 1);
  }
  return { namespace, id, version: version || undefined };
}

// Same shape as parseSpec, but with the namespace filled in and both path
// segments checked: they are about to be joined into a URL.
export function resolveSpec(spec, fallbackNamespace) {
  const parsed = parseSpec(spec);
  const namespace = parsed.namespace ?? fallbackNamespace;
  if (!namespace) {
    throw new Error(`"${spec}" names no namespace and none is stored; use @namespace/id or -n.`);
  }
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `Namespace "${namespace}" is invalid; expected lower-case letters, digits and hyphens (a-z, 0-9, -).`,
    );
  }
  if (!EXTENSION_ID_PATTERN.test(parsed.id)) {
    throw new Error(
      `Extension id "${parsed.id}" is invalid; expected 1-64 lower-case letters or digits.`,
    );
  }
  return { namespace, id: parsed.id, version: parsed.version };
}

// A version in a path is a SemVer or a dist-tag; anything with range syntax
// goes through the versions query instead.
export function isRange(version) {
  if (/[\^~*<>= ]/.test(version)) return true;
  const parts = version.split(".");
  return (
    parts.length <= 3 &&
    parts.every((part) => /^(?:0|[1-9][0-9]*|[xX])$/.test(part)) &&
    (parts.length < 3 || parts.some((part) => /^[xX]$/.test(part)))
  );
}

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// SemVer precedence, for keeping a listing merged from several hub responses
// in the same highest-first order the hub returns each part of it. Build
// metadata is ignored, as the spec requires.
export function compareVersions(a, b) {
  const left = SEMVER.exec(String(a));
  const right = SEMVER.exec(String(b));
  if (!left || !right) return String(a).localeCompare(String(b));
  for (let i = 1; i <= 3; i++) {
    if (Number(left[i]) !== Number(right[i])) return Number(left[i]) - Number(right[i]);
  }
  const leftPre = left[4] ? left[4].split(".") : null;
  const rightPre = right[4] ? right[4].split(".") : null;
  if (leftPre === null && rightPre === null) return 0;
  if (leftPre === null) return 1;
  if (rightPre === null) return -1;
  for (let i = 0; i < Math.max(leftPre.length, rightPre.length); i++) {
    if (leftPre[i] === undefined) return -1;
    if (rightPre[i] === undefined) return 1;
    if (leftPre[i] === rightPre[i]) continue;
    const leftNumeric = /^\d+$/.test(leftPre[i]);
    const rightNumeric = /^\d+$/.test(rightPre[i]);
    if (leftNumeric && rightNumeric) return Number(leftPre[i]) - Number(rightPre[i]);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPre[i] < rightPre[i] ? -1 : 1;
  }
  return 0;
}
