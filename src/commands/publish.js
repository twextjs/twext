import { compileExtension } from "../compile.js";
import { validateProject } from "../validate.js";
import { resolveOutputPath } from "../project.js";
import {
  HubError,
  NAMESPACE_PATTERN,
  acceptTerms,
  publishVersion,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";
import { createProjectTarball } from "../tarball.js";

export async function publishCommand(product, configPath, { url, token }, log) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  const { config, root } = result.project;
  const id = config.extension.id;
  const version = String(config.version);

  // The hub compiles what it receives, so this build exists only to fail
  // before the upload rather than after it.
  compileExtension(result.project, product);

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(undefined, hub);
  const authToken = resolveToken(token, hub);
  const explicitToken = token ?? process.env.TWEXTHUB_TOKEN;
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  if (typeof namespace !== "string" || !NAMESPACE_PATTERN.test(namespace)) {
    log.error(
      `Namespace "${namespace}" is invalid; expected lower-case letters, digits and hyphens (a-z, 0-9, -).`,
    );
    return false;
  }
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

  const output = resolveOutputPath(product, config, root);
  let tarball;
  try {
    tarball = await createProjectTarball(root, configPath, output);
  } catch (err) {
    log.error(`Could not pack the project: ${err.message}`);
    return false;
  }

  log.progress(`Publishing ${id}@${version} to @${namespace}...`);

  const fail = (err) => {
    log.error(err.message);
    if (err.data?.buildLog) log.raw(err.data.buildLog);
    return false;
  };

  const publish = () => publishVersion(hub, authToken, namespace, id, tarball);
  let created;
  try {
    created = await publish();
  } catch (err) {
    if (!(err instanceof HubError && err.status === 403 && /terms/i.test(err.message))) {
      return fail(err);
    }
    if (explicitToken) {
      log.error(
        `${err.message} Accept the terms with a session (twext login) before publishing again.`,
      );
      return false;
    }
    log.progress("Accepting the current Terms of Service...");
    try {
      await acceptTerms(hub, authToken, namespace);
      created = await publish();
    } catch (acceptErr) {
      return fail(acceptErr);
    }
  }

  if (created.status === "pending") {
    log.success(`${id}@${version} submitted for review (status: pending).`);
    log.info("An admin must approve it before it appears in the registry.");
  } else {
    log.success(`Published ${id}@${version}`);
    if (created.dist?.downloadUrl) log.bullet(created.dist.downloadUrl);
  }
  return true;
}
