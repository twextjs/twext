import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export function readProjectConfig(configPath) {
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`Could not read config "${configPath}": ${err.message}`, { cause: err });
  }
  return parse(text) ?? {};
}

// Where a build lands: the flag when one was given, then the manifest, then the
// default directory under the project.
export function resolveOutputPath(product, config, root, override) {
  if (override) return resolve(override);
  return config.outputPath
    ? resolve(root, config.outputPath)
    : resolve(root, product.defaults.outputDirectory, "extension.js");
}

export async function loadProject(configPath) {
  const config = readProjectConfig(configPath);
  const root = dirname(resolve(configPath));
  if (typeof config.entryPoint !== "string" || !config.entryPoint) {
    throw new Error('twext.yml must define an "entryPoint" path');
  }
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(root, config.entryPoint)).href);
  } catch (err) {
    throw new Error(`Could not load entryPoint "${config.entryPoint}": ${err.message}`, {
      cause: err,
    });
  }
  if (typeof mod.blocks !== "object" || mod.blocks === null) {
    throw new Error('The entryPoint must export a "blocks" map of opcodes to handler functions');
  }
  return { config, root, module: mod };
}
