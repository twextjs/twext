import {
  HubError,
  NAMESPACE_PATTERN,
  login,
  probeHub,
  resolveHubUrl,
  resolveNamespace,
  saveCredentials,
} from "../hub.js";
import { ask } from "../prompt.js";

export async function loginCommand(product, { url, namespace, password }, log) {
  const hub = resolveHubUrl(url);
  const { up, meta } = await probeHub(hub);
  if (!up) {
    log.error("The instance you are trying to reach is down, or you are offline.");
    return false;
  }

  if (meta) {
    log.bullet(meta.name);
    log.bullet(`Version ${meta.version}`);
    log.bullet(meta.tagline);
  }

  log.info("");

  namespace ??= resolveNamespace(undefined, hub);
  if (!namespace) namespace = await ask("Namespace: ");
  if (!NAMESPACE_PATTERN.test(namespace)) {
    log.error("Namespace must be lower-case letters, digits and hyphens (a-z, 0-9, -).");
    return false;
  }
  if (namespace) {
    log.info(`Logging in as @${namespace}`);
  }
  if (!password) password = await ask("Password: ", true);

  log.info("");

  let response;
  try {
    response = await login(hub, namespace, password);
  } catch (err) {
    log.error(err.message);
    if (err instanceof HubError && err.status === 401) {
      log.info("No account yet? Run twext signup to create one.");
    }
    return false;
  }

  if (
    !response ||
    typeof response.token !== "string" ||
    response.token === "" ||
    !response.user ||
    typeof response.user.role !== "string"
  ) {
    log.error("The hub returned an invalid login response.");
    return false;
  }

  saveCredentials({ hub, namespace, token: response.token });
  log.success(`Logged in as ${namespace}`);
  if (response.user.role === "admin")
    log.info("This account is an admin and can review pending versions.");
  return true;
}
