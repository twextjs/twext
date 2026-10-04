import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { compileExtension } from "../compile.js";
import { validateProject } from "../validate.js";
import { resolveOutputPath } from "../project.js";

// The build without the narration, so the dev server can run the first one in
// this process and skip a second cold Node start before it can serve anything.
export async function buildProduct(product, configPath, outOverride, onValidated) {
  const result = await validateProject(configPath);
  if (!result.ok) return { ok: false, errors: result.errors, warnings: [], project: null };

  const { config, root, module: mod } = result.project;
  onValidated?.(config);
  const output = resolveOutputPath(product, config, root, outOverride);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, compileExtension({ config, root, module: mod }, product), "utf8");
  return { ok: true, errors: [], warnings: result.warnings, output, config };
}

export async function buildCommand(product, configPath, outOverride, log) {
  const result = await buildProduct(product, configPath, outOverride, (config) =>
    log.progress(`Building ${config.extension?.name ?? config.name ?? "extension"}...`),
  );
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  log.success(`Built ${result.output}`);
  return true;
}
