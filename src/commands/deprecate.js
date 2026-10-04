import { resolveHubUrl, resolveNamespace, resolveToken, setDeprecation } from "../hub.js";
import { readExtensionId } from "../validate.js";

const VERSION_PATTERN = /^[0-9A-Za-z.+-]+$/;
const USAGE = "Usage: twext deprecate <version> <message> (or: twext deprecate <version> --clear)";

export async function deprecateCommand(
  product,
  version,
  messageParts,
  configPath,
  { url, token, clear, namespace: namespaceOverride },
  log,
) {
  if (!version || (!clear && messageParts.length === 0)) {
    log.error(USAGE);
    return false;
  }
  if (!VERSION_PATTERN.test(version)) {
    log.error(
      `"${version}" is not a version; expected a SemVer such as 1.2.0 or a tag such as latest.`,
    );
    return false;
  }
  const message = clear ? null : messageParts.join(" ").trim();
  if (!clear && !message) {
    log.error("The deprecation message cannot be empty.");
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(namespaceOverride, hub);
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
    id = readExtensionId(configPath, "deprecate");
  } catch (err) {
    log.error(err.message);
    return false;
  }

  try {
    await setDeprecation(hub, authToken, namespace, id, version, message);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  if (message) log.success(`Deprecated ${id}@${version}: ${message}`);
  else log.success(`Cleared the deprecation on ${id}@${version}`);
  return true;
}
