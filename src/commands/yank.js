import { readExtensionId } from "../validate.js";
import { resolveHubUrl, resolveNamespace, resolveToken, yankVersion } from "../hub.js";

export async function yankCommand(product, version, configPath, { url, token }, log) {
  if (!version) {
    log.error("Usage: twext yank <version>");
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(undefined, hub);
  const authToken = resolveToken(token, hub);
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

  let id;
  try {
    id = readExtensionId(configPath, "yank");
  } catch (err) {
    log.error(err.message);
    return false;
  }

  try {
    await yankVersion(hub, authToken, namespace, id, version);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  log.success(`Yanked ${id}@${version}`);
  return true;
}
