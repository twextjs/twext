import { day, printJson } from "../format.js";
import {
  createAutomationToken,
  listAutomationTokens,
  resolveHubUrl,
  resolveToken,
  revokeAutomationToken,
} from "../hub.js";

const USAGE = `Usage:
  twext token create [--name NAME] [--scope <scope>...] [--expires-in-days <days>]
  twext token list
  twext token revoke <id>`;

async function createToken(hub, authToken, { name, scope, "expires-in-days": expiresInDays }, log) {
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

async function listTokens(hub, authToken, json, log) {
  let page;
  try {
    page = await listAutomationTokens(hub, authToken);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  const tokens = page?.data ?? [];
  if (json) {
    printJson(log, tokens);
    return true;
  }
  if (tokens.length === 0) {
    log.info("No automation tokens.");
    return true;
  }
  log.info(`${tokens.length} token${tokens.length === 1 ? "" : "s"}`);
  for (const token of tokens) {
    const expiry = token.expiresAt ? `expires ${day(token.expiresAt)}` : "no expiry";
    const used = token.lastUsedAt ? `, last used ${day(token.lastUsedAt)}` : "";
    log.bullet(
      `${token.name} (id ${token.id}) ${token.scopes.join(", ")} — created ${day(token.createdAt)}, ${expiry}${used}`,
    );
  }
  return true;
}

async function revokeToken(hub, authToken, id, log) {
  if (!id || !/^[1-9]\d*$/.test(id)) {
    log.error(USAGE);
    return false;
  }
  try {
    await revokeAutomationToken(hub, authToken, id);
  } catch (err) {
    log.error(err.message);
    return false;
  }
  log.success(`Revoked token ${id}`);
  return true;
}

export async function tokenCommand(product, subcommand, args, values, log) {
  const hub = resolveHubUrl(values.url);
  const authToken = resolveToken(values.token, hub);
  if (!authToken) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  switch (subcommand) {
    case "create":
      return createToken(hub, authToken, values, log);
    case "list":
      return listTokens(hub, authToken, values.json, log);
    case "revoke":
      return revokeToken(hub, authToken, args[0], log);
    default:
      log.error(subcommand ? `Unknown token subcommand "${subcommand}"` : USAGE);
      return false;
  }
}
