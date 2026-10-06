import {
  BLOCK_TYPES,
  ARGUMENT_TYPES,
  EXTENSION_KEYS,
  BLOCK_KEYS,
  LABEL_BLOCK_KEYS,
  BUTTON_BLOCK_KEYS,
  ARGUMENT_KEYS,
  MENU_KEYS,
  emittedMethodNames,
  resolveSetup,
  pascalCase,
} from "./compile.js";
import { loadProject, readProjectConfig } from "./project.js";
import {
  RUNTIME_GLOBALS,
  handlerFreeVariables,
  programFreeVariables,
  topLevelDeclarations,
} from "./free-vars.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export const EXTENSION_ID_PATTERN = /^[a-z0-9]{1,64}$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const RESERVED_WORDS = new Set([
  "await",
  "arguments",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
const RESERVED_OPCODES = new Set(["constructor", "getInfo"]);

// Image-like arguments carry their own asset, so a missing dataURI renders as an
// empty slot rather than anything useful.
const DATA_URI_ARGUMENT_TYPES = new Set(["image", "costume", "sound"]);

// Every manifest shape is strict. A key the compiler would not copy is reported
// here instead of vanishing quietly between twext.yml and getInfo().
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function suggestKey(key, allowed) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of allowed) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

function rejectUnknownKeys(errors, object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (allowed.has(key)) continue;
    const hint = suggestKey(key, allowed);
    errors.push(`${label} has unknown field "${key}"${hint ? `; did you mean "${hint}"?` : ""}`);
  }
}

function validateMethods(errors, mod) {
  const methods = mod.methods;
  if (methods === undefined) return;
  if (!methods || typeof methods !== "object" || Array.isArray(methods)) {
    errors.push('The entryPoint "methods" export must be a mapping of names to functions');
    return;
  }
  for (const [name, fn] of Object.entries(methods)) {
    if (typeof fn !== "function") {
      errors.push(`Method "${name}" in the "methods" export is not a function`);
    } else if (RESERVED_OPCODES.has(name)) {
      errors.push(`Method "${name}" conflicts with a generated extension method`);
    }
  }
}

// Every registry command that acts on the project's extension (yank, tag,
// deprecate) needs the same id, read from the same place, refused the same way.
export function readExtensionId(configPath, command) {
  let id;
  try {
    id = readProjectConfig(configPath).extension?.id;
  } catch {
    id = undefined;
  }
  if (!id) {
    throw new Error(
      `"${configPath}" has no extension.id; run twext ${command} from the project directory.`,
    );
  }
  if (typeof id !== "string" || !EXTENSION_ID_PATTERN.test(id)) {
    throw new Error(`extension.id "${id}" is invalid; expected 1-64 lower-case letters or digits.`);
  }
  return id;
}

export async function validateProject(configPath) {
  const errors = [];
  const warnings = [];
  let project;
  try {
    project = await loadProject(configPath);
  } catch (err) {
    return { ok: false, errors: [err.message], warnings: [], project: null };
  }

  const { config, module: mod } = project;
  const menuNames = new Set();
  let availableMethods = null;
  const hasMethod = (name) => {
    availableMethods ??= emittedMethodNames(config, mod);
    return availableMethods.has(name);
  };

  validateMethods(errors, mod);

  if (!config.extension || typeof config.extension !== "object") {
    errors.push('twext.yml must define an "extension" section');
  } else {
    const ext = config.extension;
    rejectUnknownKeys(errors, ext, EXTENSION_KEYS, "extension");
    for (const key of ["docsURI", "menuIconURI", "blockIconURI"]) {
      if (ext[key] !== undefined && typeof ext[key] !== "string") {
        errors.push(`extension.${key} must be a string`);
      }
    }
    if (ext.isUnsandboxed !== undefined && typeof ext.isUnsandboxed !== "boolean") {
      errors.push("extension.isUnsandboxed must be a boolean");
    }
    if (typeof ext.id !== "string" || !EXTENSION_ID_PATTERN.test(ext.id)) {
      errors.push("extension.id must be 1-64 lower-case letters or digits (a-z, 0-9)");
    }
    if (!ext.name) {
      warnings.push("extension.name is missing; falling back to the project name");
    }
    if (ext.className) {
      if (
        typeof ext.className !== "string" ||
        !IDENTIFIER.test(ext.className) ||
        RESERVED_WORDS.has(ext.className)
      ) {
        errors.push(`extension.className "${ext.className}" is not a valid identifier`);
      }
    } else {
      warnings.push("extension.className is missing; deriving it from the id");
      const derivedPascal = pascalCase(ext.id || "Extension");
      const derived = /^[0-9]/.test(derivedPascal)
        ? `_${derivedPascal}Extension`
        : `${derivedPascal}Extension`;
      if (!IDENTIFIER.test(derived) || RESERVED_WORDS.has(derived)) {
        errors.push(
          "extension.className cannot be derived from the id; set it explicitly to a valid identifier",
        );
      }
    }
    validateMenus(errors, menuNames, ext.menus, hasMethod);
  }

  if (!Array.isArray(config.blocks) || config.blocks.length === 0) {
    errors.push('twext.yml must define at least one entry in "blocks"');
  } else {
    const declared = new Set();
    const published = new Set();
    for (const block of config.blocks) {
      if (typeof block === "string") {
        if (block !== "---") {
          errors.push(`Blocks entry "${block}" must be a block mapping or a "---" separator`);
        }
        continue;
      }
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        errors.push("Each blocks entry must be a mapping");
        continue;
      }
      const isLabel = block.blockType === "label";
      const isButton = block.blockType === "button";
      const name = block.opcode ?? block.text ?? "(unnamed block)";

      rejectUnknownKeys(
        errors,
        block,
        isLabel ? LABEL_BLOCK_KEYS : isButton ? BUTTON_BLOCK_KEYS : BLOCK_KEYS,
        isLabel ? `Block label "${block.text ?? ""}"` : `Block "${name}"`,
      );

      if (isButton) {
        if (typeof block.func !== "string" || !block.func) {
          errors.push(`Block button "${name}" must call a method: set "func" to its name`);
        } else if (!hasMethod(block.func)) {
          errors.push(
            `Block button "${name}" has no method named "${block.func}" exported in "methods"`,
          );
        }
      } else if (!isLabel) {
        if (typeof block.opcode !== "string" || !block.opcode) {
          errors.push("A blocks entry is missing an opcode");
          continue;
        }
        if (declared.has(block.opcode)) {
          errors.push(`Duplicate opcode "${block.opcode}" in blocks`);
        }
        if (RESERVED_OPCODES.has(block.opcode)) {
          errors.push(`Opcode "${block.opcode}" conflicts with a generated extension method`);
        }
        declared.add(block.opcode);
        if (typeof mod.blocks[block.opcode] !== "function" || !hasOwn(mod.blocks, block.opcode)) {
          errors.push(
            `Block "${block.opcode}" has no handler function exported in the "blocks" map`,
          );
        }
        if (block.func !== undefined) {
          if (typeof block.func !== "string" || !block.func) {
            errors.push(`Block "${name}" func must be a non-empty string`);
          } else if (RESERVED_OPCODES.has(block.func)) {
            errors.push(`Func "${block.func}" conflicts with a generated extension method`);
          }
        }
        const method = block.func ?? block.opcode;
        if (published.has(method)) {
          errors.push(`Duplicate published method "${method}" in blocks`);
        }
        published.add(method);
        // The class carries one method per name, so a block renaming itself onto
        // a shared method would silently lose its handler.
        if (mod.methods && hasOwn(mod.methods, method)) {
          errors.push(
            `Block "${name}" publishes method "${method}", which is already in the "methods" export`,
          );
        }
      }

      if (!isLabel) {
        if (block.blockIconURI !== undefined && typeof block.blockIconURI !== "string") {
          errors.push(`Block "${name}" blockIconURI must be a string`);
        }
        if (block.filter !== undefined) {
          if (!Array.isArray(block.filter)) {
            errors.push(`Block "${name}" filter must be a list`);
          } else {
            for (const target of block.filter) {
              if (target !== "sprite" && target !== "stage") {
                errors.push(`Block "${name}" filter entries must be "sprite" or "stage"`);
              }
            }
          }
        }
      }

      if (!isLabel && !isButton) {
        for (const flag of [
          "hideFromPalette",
          "isDynamic",
          "isTerminal",
          "disableMonitor",
          "isEdgeActivated",
          "shouldRestartExistingThreads",
        ]) {
          if (block[flag] !== undefined && typeof block[flag] !== "boolean") {
            errors.push(`Block "${name}" ${flag} must be a boolean`);
          }
        }
        if (
          block.branchCount !== undefined &&
          (!Number.isSafeInteger(block.branchCount) || block.branchCount < 1)
        ) {
          errors.push(`Block "${name}" branchCount must be a whole number of 1 or more`);
        }
        // TurboWarp ignores EVENT blocks that are not explicitly non-edge
        // activated, so a dropped flag would look like a block that never fires.
        if (block.blockType === "event" && block.isEdgeActivated !== false) {
          errors.push(`Block "${name}" is an event block, which needs "isEdgeActivated: false"`);
        }
        if (block.isEdgeActivated === true && block.shouldRestartExistingThreads === true) {
          warnings.push(
            `Block "${name}" restarts existing threads on an edge-activated hat, which TurboWarp ignores`,
          );
        }
      }

      if (
        block.blockType !== undefined &&
        block.blockType !== null &&
        !hasOwn(BLOCK_TYPES, block.blockType)
      ) {
        errors.push(`Block "${name}" uses unknown blockType "${block.blockType}"`);
      }
      if (block.text !== undefined && typeof block.text !== "string") {
        errors.push(`Block "${name}" text must be a string`);
      }
      if (block.arguments !== undefined) {
        if (
          block.arguments === null ||
          typeof block.arguments !== "object" ||
          Array.isArray(block.arguments)
        ) {
          errors.push(`Block "${name}" arguments must be a mapping`);
        } else {
          for (const [argumentName, argument] of Object.entries(block.arguments)) {
            if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
              errors.push(`Block "${name}" argument "${argumentName}" must be a mapping`);
              continue;
            }
            const argLabel = `Block "${name}" argument "${argumentName}"`;
            rejectUnknownKeys(errors, argument, ARGUMENT_KEYS, argLabel);
            if (argument.type && !hasOwn(ARGUMENT_TYPES, argument.type)) {
              errors.push(`${argLabel} uses unknown type "${argument.type}"`);
            }
            if (argument.menu !== undefined && !menuNames.has(argument.menu)) {
              errors.push(`${argLabel} references unknown menu "${argument.menu}"`);
            }
            if (argument.dataURI !== undefined && typeof argument.dataURI !== "string") {
              errors.push(`${argLabel} dataURI must be a string`);
            } else if (
              DATA_URI_ARGUMENT_TYPES.has(argument.type) &&
              typeof argument.dataURI !== "string"
            ) {
              errors.push(`${argLabel} is type "${argument.type}" and needs a dataURI`);
            }
            if (argument.flipRTL !== undefined && typeof argument.flipRTL !== "boolean") {
              errors.push(`${argLabel} flipRTL must be a boolean`);
            }
          }
        }
      }
    }
    for (const [opcode, handler] of Object.entries(mod.blocks)) {
      if (typeof handler === "function" && !declared.has(opcode)) {
        warnings.push(`Handler "${opcode}" is exported but not declared in twext.yml`);
      }
    }
    validateReferences(errors, project);
  }

  return { ok: errors.length === 0, errors, warnings, project };
}

function validateMenuItems(items, label, errors) {
  for (const item of items) {
    if (typeof item === "string") continue;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (
        !hasOwn(item, "text") ||
        !hasOwn(item, "value") ||
        typeof item.text !== "string" ||
        typeof item.value !== "string"
      ) {
        errors.push(`${label} item text and value must be strings`);
      }
      continue;
    }
    errors.push(`${label} items must be strings or { text, value } mappings`);
  }
}

function validateMenus(errors, menuNames, menus, hasMethod) {
  if (menus === undefined) return;
  if (!menus || typeof menus !== "object" || Array.isArray(menus)) {
    errors.push("extension.menus must be a mapping of menu names to menu definitions");
    return;
  }
  for (const [menuName, menu] of Object.entries(menus)) {
    menuNames.add(menuName);
    const label = `Menu "${menuName}"`;
    // A bare string names a method that supplies the items at runtime.
    if (typeof menu === "string") {
      if (!hasMethod(menu)) {
        errors.push(`${label} is dynamic, but no method named "${menu}" is exported in "methods"`);
      }
      continue;
    }
    if (Array.isArray(menu)) {
      validateMenuItems(menu, label, errors);
      continue;
    }
    if (!menu || typeof menu !== "object") {
      errors.push(`${label} must be a list of items, a mapping, or the name of a method`);
      continue;
    }
    rejectUnknownKeys(errors, menu, MENU_KEYS, label);
    if (menu.acceptReporters !== undefined && typeof menu.acceptReporters !== "boolean") {
      errors.push(`${label} acceptReporters must be a boolean`);
    }
    if (menu.items === undefined) {
      errors.push(`${label} must define items or be a plain list of items`);
    } else if (typeof menu.items === "string") {
      if (!hasMethod(menu.items)) {
        errors.push(
          `${label} is dynamic, but no method named "${menu.items}" is exported in "methods"`,
        );
      }
    } else if (!Array.isArray(menu.items)) {
      errors.push(`${label} items must be an array or the name of a method`);
    } else {
      validateMenuItems(menu.items, label, errors);
    }
  }
}

function validateReferences(errors, { config, module: mod }) {
  let setupText = "";
  try {
    setupText = resolveSetup(mod.setup);
  } catch (err) {
    errors.push(`setup is not a string, function, or array: ${err.message}`);
  }
  const available = new Set(RUNTIME_GLOBALS);
  if (setupText.trim()) {
    try {
      for (const name of topLevelDeclarations(setupText)) available.add(name);
      const missing = [...programFreeVariables(setupText)].filter((name) => !available.has(name));
      if (missing.length > 0) {
        errors.push(
          `setup references ${missing
            .map((name) => `"${name}"`)
            .join(", ")}, which is not defined in the compiled extension`,
        );
      }
    } catch (err) {
      errors.push(`setup could not be analyzed: ${err.message}`);
    }
  }

  const checkFreeVariables = (fn, label) => {
    let missing;
    try {
      missing = [...handlerFreeVariables(fn.toString())].filter((name) => !available.has(name));
    } catch (err) {
      errors.push(`${label} could not be analyzed: ${err.message}`);
      return;
    }
    if (missing.length > 0) {
      errors.push(
        `${label} references ${missing
          .map((name) => `"${name}"`)
          .join(
            ", ",
          )}, which is not defined in the compiled extension; put shared state in "setup" or inline it`,
      );
    }
  };

  for (const block of config.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const handler = mod.blocks[block.opcode];
    if (block.blockType === "label" || typeof handler !== "function") continue;
    checkFreeVariables(handler, `Handler "${block.opcode}"`);
  }

  for (const [name, fn] of Object.entries(mod.methods ?? {})) {
    if (typeof fn !== "function") continue;
    checkFreeVariables(fn, `Method "${name}"`);
  }
}
