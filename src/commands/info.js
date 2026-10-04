import { day } from "../format.js";
import {
  getExtension,
  getVersion,
  listVersions,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";
import { isRange, resolveSpec } from "../spec.js";

async function printExtension(log, hub, token, namespace, id) {
  const detail = await getExtension(hub, namespace, id, token);
  log.info(`${detail.name} @${namespace}/${id}`);
  if (detail.description) log.bullet(detail.description);
  log.bullet(`${detail.license ?? "unknown license"}${detail.author ? `, ${detail.author}` : ""}`);
  log.bullet(`latest ${detail.version} published ${day(detail.publishedAt)}`);
  const versions = detail.versions ?? [];
  if (versions.length > 0) log.info("versions:");
  for (const version of versions) {
    const note = version.deprecation ? ` — ${version.deprecation}` : "";
    log.bullet(
      `${version.version} ${version.status}${note} (${day(version.publishedAt ?? version.createdAt)})`,
    );
  }
  if (versions[0]?.dist?.downloadUrl) log.bullet(`download ${versions[0].dist.downloadUrl}`);
  log.bullet(`badge ${hub}/badge/@${namespace}/${id}`);
}

async function printVersion(log, hub, token, namespace, id, requested) {
  const version = await getVersion(hub, namespace, id, requested, token);
  log.info(`${version.name ?? id} @${namespace}/${id}@${version.version}`);
  log.bullet(`status ${version.status}${version.deprecation ? ` — ${version.deprecation}` : ""}`);
  log.bullet(
    `created ${day(version.createdAt)}${version.publishedAt ? `, published ${day(version.publishedAt)}` : ""}`,
  );
  if (version.visibility) log.bullet(`visibility ${version.visibility}`);
  if (version.dist?.downloadUrl) log.bullet(`download ${version.dist.downloadUrl}`);
  if (version.dist?.digest) log.bullet(`digest ${version.dist.digest}`);
}

async function printRange(log, hub, token, namespace, id, range) {
  const page = await listVersions(hub, namespace, id, range, token, { all: true });
  const matches = page?.data ?? [];
  if (matches.length === 0) {
    log.info(`No version of @${namespace}/${id} matches ${range}.`);
    return;
  }
  log.info(
    `${matches.length} version${matches.length === 1 ? "" : "s"} of @${namespace}/${id} match ${range} (highest first)`,
  );
  for (const version of matches) {
    log.bullet(
      `${version.version} ${version.status} (${day(version.publishedAt ?? version.createdAt)})`,
    );
  }
}

export async function infoCommand(product, spec, { url, token, namespace }, log) {
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
    if (!target.version) await printExtension(log, hub, authToken, target.namespace, target.id);
    else if (isRange(target.version))
      await printRange(log, hub, authToken, target.namespace, target.id, target.version);
    else await printVersion(log, hub, authToken, target.namespace, target.id, target.version);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  return true;
}
