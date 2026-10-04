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
