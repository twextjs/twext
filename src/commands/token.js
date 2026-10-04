import { createAutomationToken, resolveHubUrl, resolveToken } from "../hub.js";

export async function tokenCommand(
  product,
  subcommand,
  { url, token, name, scope, "expires-in-days": expiresInDays },
  log,
) {
  if (subcommand !== "create") {
    log.error(
      subcommand
        ? `Unknown token subcommand "${subcommand}"`
        : "Usage: twext token create [--name NAME] [--scope publish [--scope yank]]",
    );
    return false;
  }

  const hub = resolveHubUrl(url);
  const authToken = resolveToken(token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  const scopes = (scope ?? [])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (scopes.length === 0) scopes.push("publish");
  const invalid = scopes.find((entry) => entry !== "publish" && entry !== "yank");
  if (invalid) {
    log.error(`Unknown scope "${invalid}". Use "publish" and/or "yank".`);
    return false;
  }

  let days = undefined;
  if (expiresInDays !== undefined) {
    days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1) {
      log.error("--expires-in-days must be a positive integer.");
      return false;
    }
  }

  const body = {
    name: name ?? "CI",
    scopes,
    ...(days === undefined ? {} : { expiresInDays: days }),
  };
  let created;
  try {
    created = await createAutomationToken(hub, authToken, body);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  log.success(`Created token "${created.name}" with scope ${created.scopes.join(", ")}`);
  log.info("The token is shown once; keep it out of the repository.");
  log.bullet(created.token);
  return true;
}
