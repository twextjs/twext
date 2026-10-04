import { validateProject } from "../validate.js";

export async function validateCommand(product, configPath, log) {
  const result = await validateProject(configPath);
  for (const message of result.warnings) log.warn(message);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  const count = result.project.config.blocks.length;
  log.success(`${count} block${count === 1 ? "" : "s"} validated`);
  return true;
}
