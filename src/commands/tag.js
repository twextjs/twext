import {
  deleteDistTag,
  listDistTags,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
  setDistTag,
} from "../hub.js";
import { readExtensionId } from "../validate.js";

const TAG_PATTERN = /^[a-zA-Z0-9-]{1,30}$/;
const USAGE = "Usage: twext tag set <name> <version> | twext tag rm <name> | twext tag list";

export async function tagCommand(
  product,
  subcommand,
  args,
  configPath,
  { url, token, namespace: namespaceOverride },
  log,
) {
  if (subcommand !== "set" && subcommand !== "rm" && subcommand !== "list") {
    log.error(subcommand ? `Unknown tag subcommand "${subcommand}"` : USAGE);
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(namespaceOverride, hub);
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  let id;
  try {
    id = readExtensionId(configPath, "tag");
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const authToken = resolveToken(token, hub);
  if (subcommand === "list") {
    let tags;
    try {
      tags = await listDistTags(hub, namespace, id, authToken);
    } catch (err) {
      log.error(err.message);
      return false;
    }
    const names = Object.keys(tags ?? {});
    if (names.length === 0) {
      log.info(`@${namespace}/${id} has no tags.`);
      return true;
    }
    log.info(`${names.length} tag${names.length === 1 ? "" : "s"} on @${namespace}/${id}`);
    for (const name of names) log.bullet(`${name} → ${tags[name]}`);
    return true;
  }

  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }
  const name = args[0];
  if (!name) {
    log.error(USAGE);
    return false;
  }
  if (!TAG_PATTERN.test(name)) {
    log.error(`Tag name "${name}" is invalid; expected 1-30 letters, digits or hyphens.`);
    return false;
  }

  if (subcommand === "set") {
    const version = args[1];
    if (!version) {
      log.error("Usage: twext tag set <name> <version>");
      return false;
    }
    try {
      await setDistTag(hub, authToken, namespace, id, name, version);
    } catch (err) {
      log.error(err.message);
      return false;
    }
    log.success(`Set ${name} → ${id}@${version}`);
    return true;
  }

  try {
    await deleteDistTag(hub, authToken, namespace, id, name);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  log.success(`Removed the ${name} tag from ${id}`);
  return true;
}
