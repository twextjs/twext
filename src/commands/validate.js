import { compileExtension } from "../compile.js";
import { riskyPatternWarnings } from "../risky-patterns.js";
import { validateProject } from "../validate.js";

export async function validateCommand(product, configPath, log) {
  const result = await validateProject(configPath);
  for (const message of result.warnings) log.warn(message);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  const { config, root, module: mod } = result.project;
  const compiled = compileExtension({ config, root, module: mod }, product);
  for (const message of riskyPatternWarnings(compiled)) log.warn(message);
  const count = config.blocks.length;
  log.success(`${count} block${count === 1 ? "" : "s"} validated`);
  return true;
}
