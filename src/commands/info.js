import { day, downloads, printJson } from "../format.js";
import {
  getExtension,
  getVersion,
  HubError,
  listVersions,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";
import { compareVersions, isRange, resolveSpec } from "../spec.js";

// The hub hides pending and rejected versions from everyone but the owner of
// the extension, and it only honors the status filter for that same owner, so
// the unpublished statuses are read one at a time and folded into the
// listing. A caller who is not an owner gets a 403 here and sees exactly what
// a stranger sees.
async function ownerOnlyVersions(hub, namespace, id, token, range) {
  if (!token) return [];
  const extra = [];
  for (const status of ["pending", "rejected"]) {
    try {
      const page = await listVersions(hub, namespace, id, range, token, { status });
      extra.push(...(page?.data ?? []));
    } catch (err) {
      if (err instanceof HubError && (err.status === 401 || err.status === 403)) continue;
      throw err;
    }
  }
  return extra;
}

function mergeVersions(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const version of list) {
      if (seen.has(version.version)) continue;
      seen.add(version.version);
      merged.push(version);
    }
  }
  return merged.sort((a, b) => compareVersions(b.version, a.version));
}

async function printExtension(log, hub, token, namespace, id, json) {
  const detail = await getExtension(hub, namespace, id, token);
  const versions = mergeVersions(
    detail.versions ?? [],
    await ownerOnlyVersions(hub, namespace, id, token),
  );
  if (json) return printJson(log, { ...detail, versions });
  log.info(`${detail.name} @${namespace}/${id}`);
  if (detail.description) log.bullet(detail.description);
  log.bullet(`${detail.license ?? "unknown license"}${detail.author ? `, ${detail.author}` : ""}`);
  log.bullet(`latest ${detail.version} published ${day(detail.publishedAt)}`);
  if (versions.length > 0) log.info("versions:");
  for (const version of versions) {
    const note = version.deprecation
      ? ` — ${version.deprecation}`
      : version.rejectionReason
        ? ` — ${version.rejectionReason}`
        : "";
    log.bullet(
      `${version.version} ${version.status}${note} (${day(version.publishedAt ?? version.createdAt)}${downloads(version)})`,
    );
  }
  if (versions[0]?.dist?.downloadUrl) log.bullet(`download ${versions[0].dist.downloadUrl}`);
  log.bullet(`badge ${hub}/badge/@${namespace}/${id}`);
}

async function printVersion(log, hub, token, namespace, id, requested, json) {
  const version = await getVersion(hub, namespace, id, requested, token);
  if (json) return printJson(log, version);
  log.info(`${version.name ?? id} @${namespace}/${id}@${version.version}`);
  log.bullet(`status ${version.status}${version.deprecation ? ` — ${version.deprecation}` : ""}`);
  log.bullet(
    `created ${day(version.createdAt)}${version.publishedAt ? `, published ${day(version.publishedAt)}` : ""}`,
  );
  if (typeof version.downloads === "number") {
    log.bullet(`${version.downloads} download${version.downloads === 1 ? "" : "s"}`);
  }
  if (version.dist?.downloadUrl) log.bullet(`download ${version.dist.downloadUrl}`);
  if (version.dist?.digest) log.bullet(`digest ${version.dist.digest}`);
}

async function printRange(log, hub, token, namespace, id, range, json) {
  const page = await listVersions(hub, namespace, id, range, token, { all: true });
  const matches = mergeVersions(
    page?.data ?? [],
    await ownerOnlyVersions(hub, namespace, id, token, range),
  );
  if (json) return printJson(log, matches);
  if (matches.length === 0) {
    log.info(`No version of @${namespace}/${id} matches ${range}.`);
    return;
  }
  log.info(
    `${matches.length} version${matches.length === 1 ? "" : "s"} of @${namespace}/${id} match ${range} (highest first)`,
  );
  for (const version of matches) {
    log.bullet(
      `${version.version} ${version.status} (${day(version.publishedAt ?? version.createdAt)}${downloads(version)})`,
    );
  }
}

export async function infoCommand(product, spec, { url, token, namespace, json }, log) {
  if (!spec) {
    log.error("Usage: twext info <id>[@version]");
    return false;
  }
  const hub = resolveHubUrl(url);
  let target;
  try {
    target = resolveSpec(spec, resolveNamespace(namespace, hub));
  } catch (err) {
    log.error(err.message);
    return false;
  }
  const authToken = resolveToken(token, hub);
  try {
    if (!target.version)
      await printExtension(log, hub, authToken, target.namespace, target.id, json);
    else if (isRange(target.version))
      await printRange(log, hub, authToken, target.namespace, target.id, target.version, json);
    else await printVersion(log, hub, authToken, target.namespace, target.id, target.version, json);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  return true;
}
