import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { extract as extractTar } from "tar";
import {
  downloadSource,
  getVersion,
  listVersions,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";
import { isRange, resolveSpec } from "../spec.js";

function extractTarball(buffer, cwd) {
  return new Promise((finish, fail) => {
    const stream = extractTar({ cwd, gzip: true, strict: true });
    stream.on("close", finish);
    stream.on("error", fail);
    stream.end(buffer);
  });
}

export async function checkoutCommand(product, spec, directory, { url, token, namespace }, log) {
  if (!spec) {
    log.error("Usage: twext checkout <id>[@version] [directory]");
    return false;
  }

  const hub = resolveHubUrl(url);
  const authToken = resolveToken(token, hub);
  const storedNamespace = resolveNamespace(namespace, hub);
  if (!authToken || !storedNamespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }

  let target;
  try {
    target = resolveSpec(spec, storedNamespace);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const destination = resolve(directory ?? target.id);
  const shown = relative(process.cwd(), destination) || ".";
  if (existsSync(destination)) {
    if (!statSync(destination).isDirectory()) {
      log.error(`${shown} exists and is not a directory`);
      return false;
    }
    if (readdirSync(destination).length > 0) {
      log.error(`${shown} exists and is not empty`);
      return false;
    }
  }

  try {
    let version = target.version ?? "latest";
    if (isRange(version)) {
      const page = await listVersions(hub, target.namespace, target.id, version, authToken, {
        all: true,
      });
      const match = page?.data?.[0];
      if (!match) {
        log.error(`No version of @${target.namespace}/${target.id} matches ${version}.`);
        return false;
      }
      version = match.version;
    }
    const meta = await getVersion(hub, target.namespace, target.id, version, authToken);
    version = meta.version;
    const tarball = await downloadSource(hub, authToken, target.namespace, target.id, version);
    mkdirSync(dirname(destination), { recursive: true });
    const staging = mkdtempSync(join(dirname(destination), ".twext-checkout-"));
    try {
      await extractTarball(tarball, staging);
      if (existsSync(destination)) {
        const moved = [];
        try {
          for (const entry of readdirSync(staging)) {
            renameSync(join(staging, entry), join(destination, entry));
            moved.push(entry);
          }
        } catch (err) {
          for (const entry of moved) {
            rmSync(join(destination, entry), { recursive: true, force: true });
          }
          throw err;
        }
      } else {
        renameSync(staging, destination);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    log.success(`Checked out @${target.namespace}/${target.id}@${version} into ${shown}`);
    return true;
  } catch (err) {
    log.error(err.message);
    return false;
  }
}
