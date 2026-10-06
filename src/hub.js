import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".twext");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const DEFAULT_HUB_URL = "https://twexts.sdisk.us/api/v1";

export class HubError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function loadCredentials() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveCredentials(credentials) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

export function clearCredentials() {
  rmSync(CONFIG_FILE, { force: true });
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 30_000;

function canonicalHubUrl(url) {
  return typeof url === "string" ? url.replace(/\/+$/, "") : url;
}

function validateHubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HubError(`Invalid hub URL: ${url}`);
  }
  if (parsed.protocol === "https:") return canonicalHubUrl(url);
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
    return canonicalHubUrl(url);
  throw new HubError(
    `Refusing to send credentials to ${url}; use an https:// hub or a loopback address.`,
  );
}

export function resolveHubUrl(flag, env = process.env) {
  return validateHubUrl(flag ?? env.TWEXTHUB_URL ?? loadCredentials().hub ?? DEFAULT_HUB_URL);
}

function storedCredentialsFor(hub) {
  const credentials = loadCredentials();
  return typeof credentials.hub === "string" &&
    canonicalHubUrl(credentials.hub) === canonicalHubUrl(hub)
    ? credentials
    : {};
}

export function resolveToken(flag, hub, env = process.env) {
  return flag ?? env.TWEXTHUB_TOKEN ?? storedCredentialsFor(hub).token;
}

export function resolveNamespace(flag, hub, env = process.env) {
  return flag ?? env.TWEXTHUB_NAMESPACE ?? storedCredentialsFor(hub).namespace;
}

async function hubRequest(
  base,
  path,
  { method = "GET", token, body, raw, contentType, binary } = {},
) {
  const url = `${base.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(raw !== undefined
          ? { "content-type": contentType }
          : body === undefined
            ? {}
            : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HubError(
        `The hub at ${base} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
      );
    }
    throw new HubError(`Could not reach the hub at ${base}: ${err.message}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (binary && response.ok) return buffer;
  const text = buffer.toString("utf8");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    if (response.ok) throw err;
  }
  if (!response.ok) {
    const detail =
      data?.detail ??
      data?.errors?.map((error) => `${error.field}: ${error.message}`).join("; ") ??
      (data?.title ? `${data.title} (HTTP ${response.status})` : `HTTP ${response.status}`);
    throw new HubError(detail, response.status, data);
  }
  return data;
}

export async function login(base, namespace, password) {
  return hubRequest(base, "/sessions", { method: "POST", body: { namespace, password } });
}

export async function signup(base, namespace, password, displayName) {
  return hubRequest(base, "/users", {
    method: "POST",
    body: { namespace, password, ...(displayName ? { displayName } : {}) },
  });
}

// Acceptance is recorded against the text the account is shown, so the version
// has to be read from the hub first and then patched onto the caller's own user.
export async function acceptTerms(base, token, namespace) {
  const terms = await hubRequest(base, "/terms");
  return hubRequest(base, `/users/${namespace}`, {
    method: "PATCH",
    token,
    body: { termsAcceptedVersion: terms.version },
  });
}

export async function publishVersion(base, token, namespace, id, tarball) {
  return hubRequest(base, `/@${namespace}/${id}/versions`, {
    method: "POST",
    token,
    raw: tarball,
    contentType: "application/gzip",
  });
}

export async function yankVersion(base, token, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${version}`, { method: "DELETE", token });
}

export async function createAutomationToken(base, token, body) {
  return hubRequest(base, "/tokens", { method: "POST", token, body });
}

export async function revokeCurrentSession(base, token) {
  return hubRequest(base, "/sessions/current", { method: "DELETE", token });
}

export async function revokeCurrentToken(base, token) {
  return hubRequest(base, "/tokens/current", { method: "DELETE", token });
}

// These reads are public for published versions, but the hub only shows a caller
// its own when the request carries a bearer token.
export async function getExtension(base, namespace, id, token) {
  return hubRequest(base, `/@${namespace}/${id}`, { token });
}

export async function getVersion(base, namespace, id, version, token) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${encodeURIComponent(version)}`, {
    token,
  });
}

async function allPages(base, path, token) {
  const root = new URL(`${base.replace(/\/+$/, "")}/`);
  let url = new URL(path.replace(/^\/+/, ""), root);
  const seen = new Set();
  const data = [];
  let page;
  while (url) {
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
      throw new HubError("The hub returned a pagination link outside its API.");
    }
    if (seen.has(url.href)) throw new HubError("The hub returned a repeated pagination link.");
    seen.add(url.href);
    page = await hubRequest(base, url.pathname.slice(root.pathname.length) + url.search, { token });
    data.push(...(page?.data ?? []));
    url = page?._links?.next ? new URL(page._links.next, url) : null;
  }
  return { ...page, data };
}

// Highest SemVer first, so the first entry is the one a range resolves to.
export async function listVersions(base, namespace, id, range, token, { all = false } = {}) {
  const query = new URLSearchParams({ limit: "50" });
  if (range) query.set("range", range);
  const path = `/@${namespace}/${id}/versions?${query}`;
  return all ? allPages(base, path, token) : hubRequest(base, path, { token });
}

export async function searchExtensions(base, query, sort, token) {
  const params = new URLSearchParams({ limit: "50" });
  if (query) params.set("query", query);
  if (sort) params.set("sort", sort);
  return allPages(base, `/search?${params}`, token);
}

export async function downloadSource(base, token, namespace, id, version) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${encodeURIComponent(version)}/source`, {
    token,
    binary: true,
  });
}

export async function listNotifications(base, token) {
  return hubRequest(base, "/notifications?limit=20", { token });
}

export async function markNotificationsRead(base, token, ids) {
  return hubRequest(base, "/notifications", { method: "PATCH", token, body: { ids } });
}

export async function listDistTags(base, namespace, id, token) {
  return hubRequest(base, `/@${namespace}/${id}/tags`, { token });
}

export async function setDistTag(base, token, namespace, id, tag, version) {
  return hubRequest(base, `/@${namespace}/${id}/tags/${encodeURIComponent(tag)}`, {
    method: "PUT",
    token,
    body: { version },
  });
}

export async function deleteDistTag(base, token, namespace, id, tag) {
  return hubRequest(base, `/@${namespace}/${id}/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
    token,
  });
}

export async function setDeprecation(base, token, namespace, id, version, message) {
  return hubRequest(base, `/@${namespace}/${id}/versions/${encodeURIComponent(version)}`, {
    method: "PATCH",
    token,
    body: { deprecationMessage: message },
  });
}

// An organization is a namespace with an owner list instead of a password: the
// caller becomes its first owner, and after that only the owner list can change
// it. Adding an owner is a PUT that answers 204 whether or not the account was
// already one.
export async function createOrganization(base, token, body) {
  return hubRequest(base, "/orgs", { method: "POST", token, body });
}

export async function getOrganization(base, namespace) {
  return hubRequest(base, `/orgs/${namespace}`);
}

export async function updateOrganization(base, token, namespace, body) {
  return hubRequest(base, `/orgs/${namespace}`, { method: "PATCH", token, body });
}

export async function deleteOrganization(base, token, namespace) {
  return hubRequest(base, `/orgs/${namespace}`, { method: "DELETE", token });
}

export async function listOrganizations(base) {
  return allPages(base, "/orgs?limit=50");
}

export async function listOrganizationOwners(base, namespace) {
  return hubRequest(base, `/orgs/${namespace}/owners`);
}

export async function addOrganizationOwner(base, token, namespace, ownerNamespace) {
  return hubRequest(base, `/orgs/${namespace}/owners/${ownerNamespace}`, { method: "PUT", token });
}

export async function removeOrganizationOwner(base, token, namespace, ownerNamespace) {
  return hubRequest(base, `/orgs/${namespace}/owners/${ownerNamespace}`, {
    method: "DELETE",
    token,
  });
}

// An owner of the organization sees its unpublished extensions in the listing,
// which only happens when the request carries a bearer token.
export async function listOrganizationExtensions(base, namespace, sort, license, token) {
  const query = new URLSearchParams({ limit: "50" });
  if (sort) query.set("sort", sort);
  if (license) query.set("license", license);
  return allPages(base, `/orgs/${namespace}/extensions?${query}`, token);
}
