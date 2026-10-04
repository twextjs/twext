import { NAMESPACE_PATTERN, resolveHubUrl, saveCredentials, signup } from "../hub.js";
import { ask } from "../prompt.js";

export async function signupCommand(
  product,
  { url, namespace, password, "display-name": displayName },
  log,
) {
  const hub = resolveHubUrl(url);
  if (!namespace) namespace = await ask("Namespace: ");
  if (!NAMESPACE_PATTERN.test(namespace)) {
    log.error("Namespace must be lower-case letters, digits and hyphens (a-z, 0-9, -).");
    return false;
  }
  if (!password) password = await ask("Password: ", true);

  try {
    const response = await signup(hub, namespace, password, displayName);
    if (
      !response ||
      typeof response.token !== "string" ||
      response.token === "" ||
      !response.user ||
      typeof response.user.role !== "string"
    ) {
      throw new Error("The hub returned an invalid signup response.");
    }
    saveCredentials({ hub, namespace, token: response.token });
    log.success(`Signed up as ${namespace}`);
    if (response.user.role === "admin") {
      log.info("This account is an admin and can review pending versions.");
    }
    return true;
  } catch (err) {
    log.error(err.message);
    return false;
  }
}
