import { day } from "../format.js";
import {
  HubError,
  NAMESPACE_PATTERN,
  acceptTerms,
  addOrganizationOwner,
  createOrganization,
  deleteOrganization,
  getOrganization,
  listOrganizationExtensions,
  listOrganizationOwners,
  listOrganizations,
  removeOrganizationOwner,
  resolveHubUrl,
  resolveToken,
  sessionNamespace,
  updateOrganization,
} from "../hub.js";

const SORTS = ["recent", "downloads", "updated", "name"];
const PROFILE = "--display-name <name> [--bio <text>] [--website <url>] [--github <user>]";
const SUBCOMMANDS = [
  "create",
  "list",
  "info",
  "update",
  "delete",
  "owners",
  "add",
  "remove",
  "extensions",
];
const NEEDS_TOKEN = ["create", "update", "delete", "add", "remove"];
const USAGE = `Usage:
  twext org create <namespace> ${PROFILE}
  twext org list
  twext org info <namespace>
  twext org update <namespace> ${PROFILE}
  twext org delete <namespace> --force
  twext org owners <namespace>
  twext org add <namespace> <account>
  twext org remove <namespace> <account>
  twext org extensions <namespace> [--sort <key>] [--license <id>]`;

// Only the flags that were passed are sent, so an update leaves the rest of the
// profile alone. A field sent as null is cleared at the hub, which is what an
// empty flag means.
function profileBody({ "display-name": displayName, bio, website, github }) {
  const clear = (value) => (value === "" ? null : value);
  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(bio === undefined ? {} : { bio: clear(bio) }),
    ...(website === undefined ? {} : { website: clear(website) }),
    ...(github === undefined ? {} : { github: clear(github) }),
  };
}

// The organization namespace is the first argument of every subcommand and it
// goes straight into a path, so it is checked before anything is sent.
function readNamespace(value, log, usage = USAGE) {
  if (!value) {
    log.error(usage);
    return null;
  }
  if (!NAMESPACE_PATTERN.test(value)) {
    log.error(
      `Namespace "${value}" is invalid; expected lower-case letters, digits and hyphens (a-z, 0-9, -).`,
    );
    return null;
  }
  return value;
}

// The hub gates an organization on the Terms of Service the same way it gates a
// publish, and the acceptance is recorded against the caller's account rather
// than against the organization, so only a session can make it.
async function createOrganizationWithTerms(hub, token, body, values, log) {
  const create = () => createOrganization(hub, token, body);
  try {
    await create();
  } catch (err) {
    if (!(err instanceof HubError && err.status === 403 && /terms/i.test(err.message))) throw err;
    const account = sessionNamespace(token);
    if ((values.token ?? process.env.TWEXTHUB_TOKEN) || !account) {
      throw new Error(
        `${err.message} Accept the terms with a session (twext login) before creating it again.`,
        { cause: err },
      );
    }
    log.progress("Accepting the current Terms of Service...");
    await acceptTerms(hub, token, account);
    await create();
  }
}

export async function orgCommand(product, subcommand, args, values, log) {
  if (!SUBCOMMANDS.includes(subcommand)) {
    log.error(subcommand ? `Unknown org subcommand "${subcommand}"` : USAGE);
    return false;
  }

  const hub = resolveHubUrl(values.url);
  const token = resolveToken(values.token, hub);
  if (NEEDS_TOKEN.includes(subcommand) && !token) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

  switch (subcommand) {
    case "create": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      try {
        await createOrganizationWithTerms(
          hub,
          token,
          { namespace, ...profileBody(values) },
          values,
          log,
        );
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.success(`Created organization @${namespace}`);
      log.info(`Publish under it with twext publish --namespace ${namespace}`);
      return true;
    }
    case "update": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      const body = profileBody(values);
      if (Object.keys(body).length === 0) {
        log.error(`Nothing to change. Pass ${PROFILE}.`);
        return false;
      }
      try {
        await updateOrganization(hub, token, namespace, body);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.success(`Updated @${namespace}`);
      return true;
    }
    case "delete": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      if (!values.force) {
        log.error(
          `Deleting @${namespace} takes its extensions, versions, images and webhooks with it. Pass --force to confirm.`,
        );
        return false;
      }
      try {
        await deleteOrganization(hub, token, namespace);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.success(`Deleted @${namespace}`);
      return true;
    }
    case "add": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      const account = readNamespace(args[1], log, "Usage: twext org add <namespace> <account>");
      if (!account) return false;
      try {
        await addOrganizationOwner(hub, token, namespace, account);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.success(`Added @${account} as an owner of @${namespace}`);
      return true;
    }
    case "remove": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      const account = readNamespace(args[1], log, "Usage: twext org remove <namespace> <account>");
      if (!account) return false;
      try {
        await removeOrganizationOwner(hub, token, namespace, account);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.success(`Removed @${account} as an owner of @${namespace}`);
      return true;
    }
    case "list": {
      let page;
      try {
        page = await listOrganizations(hub);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      const orgs = page?.data ?? [];
      if (orgs.length === 0) {
        log.info("No organizations yet.");
        return true;
      }
      log.info(`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`);
      for (const org of orgs) log.bullet(`${org.displayName} (@${org.namespace})`);
      return true;
    }
    case "info": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      let org;
      try {
        org = await getOrganization(hub, namespace);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      log.info(`${org.displayName} (@${org.namespace})`);
      if (org.bio) log.bullet(org.bio);
      if (org.website) log.bullet(org.website);
      if (org.github) log.bullet(`github.com/${org.github}`);
      log.bullet(`created ${day(org.createdAt)}`);
      return true;
    }
    case "owners": {
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      let page;
      try {
        page = await listOrganizationOwners(hub, namespace);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      const owners = page?.data ?? [];
      if (owners.length === 0) {
        log.info(`@${namespace} has no owners.`);
        return true;
      }
      log.info(`${owners.length} owner${owners.length === 1 ? "" : "s"} of @${namespace}`);
      for (const owner of owners) {
        log.bullet(`${owner.displayName} (@${owner.namespace}) since ${day(owner.addedAt)}`);
      }
      return true;
    }
    case "extensions": {
      if (values.sort !== undefined && !SORTS.includes(values.sort)) {
        log.error(`--sort must be one of ${SORTS.join(", ")}.`);
        return false;
      }
      const namespace = readNamespace(args[0], log);
      if (!namespace) return false;
      let page;
      try {
        page = await listOrganizationExtensions(hub, namespace, values.sort, values.license, token);
      } catch (err) {
        log.error(err.message);
        return false;
      }
      const extensions = page?.data ?? [];
      if (extensions.length === 0) {
        log.info(`@${namespace} has no extensions.`);
        return true;
      }
      log.info(
        `${extensions.length} extension${extensions.length === 1 ? "" : "s"} in @${namespace}`,
      );
      for (const extension of extensions) {
        log.bullet(
          `${extension.name} (@${extension.namespace}/${extension.id}@${extension.version})`,
        );
      }
      return true;
    }
  }
}
