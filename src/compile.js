import { parseFunctionSource } from "./function-source.js";

export const BLOCK_TYPES = {
  command: "Scratch.BlockType.COMMAND",
  reporter: "Scratch.BlockType.REPORTER",
  boolean: "Scratch.BlockType.BOOLEAN",
  hat: "Scratch.BlockType.HAT",
  event: "Scratch.BlockType.EVENT",
  loop: "Scratch.BlockType.LOOP",
  cond: "Scratch.BlockType.CONDITIONAL",
  cblock: "Scratch.BlockType.CONDITIONAL",
  button: "Scratch.BlockType.BUTTON",
  label: "Scratch.BlockType.LABEL",
};

export const ARGUMENT_TYPES = {
  string: "Scratch.ArgumentType.STRING",
  text: "Scratch.ArgumentType.STRING",
  number: "Scratch.ArgumentType.NUMBER",
  boolean: "Scratch.ArgumentType.BOOLEAN",
  angle: "Scratch.ArgumentType.ANGLE",
  color: "Scratch.ArgumentType.COLOR",
  matrix: "Scratch.ArgumentType.MATRIX",
  note: "Scratch.ArgumentType.NOTE",
  image: "Scratch.ArgumentType.IMAGE",
  costume: "Scratch.ArgumentType.COSTUME",
  sound: "Scratch.ArgumentType.SOUND",
};

// TurboWarp's getInfo() carries more fields than Twext structures itself. The
// compiler copies these through verbatim and validate.js is what keeps the list
// honest, so a key that reaches the output is a key that was type-checked.
const INFO_PASSTHROUGH = ["docsURI", "menuIconURI", "blockIconURI"];

const BLOCK_PASSTHROUGH = [
  "hideFromPalette",
  "blockIconURI",
  "filter",
  "isDynamic",
  "isTerminal",
  "disableMonitor",
  "isEdgeActivated",
  "shouldRestartExistingThreads",
  "branchCount",
];

const ARGUMENT_PASSTHROUGH = ["dataURI", "flipRTL"];

// TurboWarp sets Scratch.extensions.unsandboxed when it loads an extension
// without the sandbox.
const UNSANDBOXED_ERROR = "This extension must run unsandboxed!";

// The complete set of keys each manifest shape may carry. validate.js rejects
// everything else, so these lists are the contract that keeps compilation from
// silently dropping fields.
export const EXTENSION_KEYS = new Set([
  "id",
  "name",
  "className",
  "color1",
  "color2",
  "color3",
  "isUnsandboxed",
  "menus",
  ...INFO_PASSTHROUGH,
]);

export const BLOCK_KEYS = new Set([
  "opcode",
  "func",
  "blockType",
  "text",
  "arguments",
  ...BLOCK_PASSTHROUGH,
]);

// Labels are inert text. TurboWarp warns about an opcode on one, and there is no
// handler to hang executable-block fields off.
export const LABEL_BLOCK_KEYS = new Set(["blockType", "text"]);

// Buttons dispatch straight to a method rather than to a block handler.
export const BUTTON_BLOCK_KEYS = new Set(["blockType", "text", "filter", "func"]);

export const ARGUMENT_KEYS = new Set(["type", "defaultValue", "menu", ...ARGUMENT_PASSTHROUGH]);

export const MENU_KEYS = new Set(["items", "acceptReporters"]);

const INDENT = "  ";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validIdentifier(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

function methodName(name) {
  return validIdentifier(name) ? name : JSON.stringify(name);
}

const ENUM_MARKER = Symbol("enum");

function enumCode(value) {
  return { [ENUM_MARKER]: value };
}

function renderScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function emitKey(key, value, level) {
  const name = validIdentifier(key) ? key : JSON.stringify(key);
  const pad = INDENT.repeat(level);
  if (value !== null && typeof value === "object" && value[ENUM_MARKER]) {
    return [`${pad}${name}: ${value[ENUM_MARKER]},`];
  }
  if (value === null || typeof value !== "object") {
    return [`${pad}${name}: ${renderScalar(value)},`];
  }
  if (Array.isArray(value)) {
    const lines = [`${pad}${name}: [`];
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        lines.push(...emitObject(item, level + 1));
      } else {
        lines.push(`${pad}${INDENT}${renderScalar(item)},`);
      }
    }
    lines.push(`${pad}],`);
    return lines;
  }
  const lines = [`${pad}${name}: {`];
  for (const [innerKey, innerValue] of Object.entries(value)) {
    lines.push(...emitKey(innerKey, innerValue, level + 1));
  }
  lines.push(`${pad}},`);
  return lines;
}

function emitFields(object, level) {
  const lines = [];
  for (const key of Object.keys(object)) {
    lines.push(...emitKey(key, object[key], level));
  }
  return lines;
}

function emitObject(object, level) {
  return [
    INDENT.repeat(level) + "{",
    ...emitFields(object, level + 1),
    INDENT.repeat(level) + "},",
  ];
}

export function resolveSetup(setup) {
  if (setup === null || setup === undefined) return "";
  if (typeof setup === "string") return setup;
  if (typeof setup === "function") {
    const parsed = parseFunctionSource(setup.toString());
    if (!parsed) throw new Error("Could not parse setup function");
    return parsed.expressionBody ? `${parsed.body};` : parsed.body;
  }
  if (Array.isArray(setup)) return setup.map(resolveSetup).join("\n");
  throw new TypeError('"setup" export must be a string, function, or array of strings');
}

function markStringContentLines(text) {
  const lines = text.split("\n");
  const content = new Array(lines.length).fill(false);
  let state = "code";
  let prev = "code";
  let quote = "";
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    if (state === "template" || state === "comment" || state === "string") {
      content[i] = true;
    }
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      const c = line[j];
      const next = line[j + 1];
      if (state === "code" || state === "expr") {
        if (c === "/" && next === "/") {
          j = line.length;
        } else if (c === "/" && next === "*") {
          prev = state;
          state = "comment";
          j += 2;
        } else if (c === '"' || c === "'") {
          prev = state;
          quote = c;
          state = "string";
          j += 1;
        } else if (c === "`") {
          prev = state;
          state = "template";
          j += 1;
        } else if (state === "expr" && c === "{") {
          braceDepth += 1;
          j += 1;
        } else if (state === "expr" && c === "}") {
          braceDepth -= 1;
          if (braceDepth === 0) state = "template";
          j += 1;
        } else {
          j += 1;
        }
        continue;
      }
      if (state === "string") {
        if (c === "\\") {
          j += 2;
        } else if (c === quote) {
          state = prev;
          j += 1;
        } else {
          j += 1;
        }
        continue;
      }
      if (state === "comment") {
        if (c === "*" && next === "/") {
          state = prev;
          j += 2;
        } else {
          j += 1;
        }
        continue;
      }
      if (c === "\\") {
        j += 2;
      } else if (c === "`") {
        state = prev;
        j += 1;
      } else if (c === "$" && next === "{") {
        state = "expr";
        braceDepth = 1;
        j += 2;
      } else {
        j += 1;
      }
    }
  }

  return content;
}

function dedent(text) {
  const lines = text.split("\n");
  const content = markStringContentLines(text);
  const indents = [];
  for (let i = 0; i < lines.length; i++) {
    if (content[i]) continue;
    const line = lines[i];
    if (line.trim() === "") continue;
    indents.push(line.match(/^\s*/)[0].length);
  }
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((line, i) => (content[i] ? line : line.slice(min))).join("\n");
}

function indentCode(text, level) {
  const pad = INDENT.repeat(level);
  const content = markStringContentLines(text);
  return text
    .split("\n")
    .map((line, i) => (content[i] ? line : pad + line))
    .join("\n");
}

export function pascalCase(text) {
  return String(text)
    .replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function copyPassthrough(target, source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

function buildBlock(block) {
  if (typeof block === "string") return block;
  const type =
    block.blockType == null
      ? BLOCK_TYPES.reporter
      : hasOwn(BLOCK_TYPES, block.blockType)
        ? BLOCK_TYPES[block.blockType]
        : undefined;
  if (!type) throw new Error(`Unknown blockType "${block.blockType}" for block "${block.opcode}"`);
  if (type === BLOCK_TYPES.label) {
    return { blockType: enumCode(type), text: block.text ?? "" };
  }
  // A button has no opcode; it calls the method named by `func`.
  if (type === BLOCK_TYPES.button) {
    const button = { blockType: enumCode(type), text: block.text ?? "" };
    copyPassthrough(button, block, ["func", "filter"]);
    return button;
  }
  const out = {
    opcode: block.opcode,
    blockType: enumCode(type),
    text: block.text ?? block.opcode,
  };
  copyPassthrough(out, block, ["func", ...BLOCK_PASSTHROUGH]);
  if (block.arguments && typeof block.arguments === "object") {
    const argumentNames = Object.keys(block.arguments);
    if (argumentNames.length > 0) {
      out.arguments = {};
      for (const name of argumentNames) {
        out.arguments[name] = buildArgument(block.arguments[name]);
      }
    }
  }
  return out;
}

function buildArgument(argument) {
  const type = hasOwn(ARGUMENT_TYPES, argument.type)
    ? ARGUMENT_TYPES[argument.type]
    : ARGUMENT_TYPES.string;
  const out = { type: enumCode(type) };
  if (argument.defaultValue !== undefined) out.defaultValue = argument.defaultValue;
  if (argument.menu !== undefined) out.menu = argument.menu;
  copyPassthrough(out, argument, ARGUMENT_PASSTHROUGH);
  return out;
}

function buildMenus(menus) {
  const out = {};
  for (const [name, menu] of Object.entries(menus)) {
    // A bare string names a method that supplies the items at runtime.
    if (typeof menu === "string") {
      out[name] = { items: menu };
      continue;
    }
    if (Array.isArray(menu)) {
      out[name] = { items: menu };
      continue;
    }
    out[name] = { items: menu.items ?? [] };
    if (menu.acceptReporters !== undefined) {
      out[name].acceptReporters = menu.acceptReporters;
    }
  }
  return out;
}

function renderMethod(name, handler, descriptor) {
  const parsed = parseFunctionSource(handler.toString());
  if (!parsed) {
    throw new Error(`Could not parse handler function for ${descriptor}`);
  }
  const head = `    ${parsed.async ? "async " : ""}${methodName(name)}(${parsed.params}) {`;
  const source = parsed.expressionBody ? `return ${parsed.body};` : parsed.body;
  const body = dedent(source).trim();
  if (!body) return `${head}\n    }`;
  return `${head}\n${indentCode(body, 3)}\n    }`;
}

// Every method the generated class ends up with, keyed by its class method name.
// Block handlers are looked up by opcode but named by `func` when one is given,
// and the optional `methods` export supplies shared helpers plus the functions
// that dynamic menus and buttons dispatch to.
function collectMethods(config, mod) {
  const methods = new Map();
  for (const [name, fn] of Object.entries(mod.methods ?? {})) {
    if (typeof fn === "function") methods.set(name, { fn, descriptor: `method "${name}"` });
  }
  for (const block of config.blocks) {
    if (typeof block !== "object" || block === null) continue;
    if (block.blockType === "label") continue;
    if (typeof block.opcode !== "string") continue;
    const fn = mod.blocks[block.opcode];
    if (typeof fn !== "function") continue;
    const name = block.func ?? block.opcode;
    if (!methods.has(name)) methods.set(name, { fn, descriptor: `block "${block.opcode}"` });
  }
  return methods;
}

// The names that actually end up on the generated class. A button or a dynamic
// menu can only dispatch to one of these, which is a stricter question than "is
// there a function under this name in the module".
export function emittedMethodNames(config, mod) {
  return new Set(collectMethods(config, mod).keys());
}

export function compileExtension(project, product) {
  const { config, module: mod } = project;
  const ext = config.extension ?? {};
  const fallback = product?.defaults?.fallbackColor ?? "#0070F3";
  const derived = pascalCase(ext.id || "Extension") + "Extension";
  const rawClassName = ext.className || derived;
  const className = validIdentifier(rawClassName) ? rawClassName : `_${pascalCase(rawClassName)}`;

  const info = {
    id: ext.id,
    name: ext.name ?? config.name ?? ext.id,
    color1: ext.color1 ?? fallback,
    ...(ext.color2 !== undefined && { color2: ext.color2 }),
    ...(ext.color3 !== undefined && { color3: ext.color3 }),
    ...(ext.menus !== undefined && { menus: buildMenus(ext.menus) }),
    ...copyPassthrough({}, ext, INFO_PASSTHROUGH),
    blocks: config.blocks.map(buildBlock),
  };

  const setup = dedent(resolveSetup(mod.setup).trim());
  const lines = ["(function (Scratch) {", '  "use strict";'];
  // Before setup, so a sandboxed load fails before any of it runs.
  if (ext.isUnsandboxed) {
    lines.push(
      "",
      "  if (!Scratch.extensions.unsandboxed) {",
      `    throw new Error(${JSON.stringify(UNSANDBOXED_ERROR)});`,
      "  }",
    );
  }
  if (setup) lines.push("", indentCode(setup, 1));
  lines.push("", `  class ${className} {`, "    getInfo() {", "      return {");
  lines.push(...emitFields(info, 4));
  lines.push("      };", "    }");
  const methods = [...collectMethods(config, mod)]
    .map(([name, { fn, descriptor }]) => renderMethod(name, fn, descriptor))
    .join("\n\n");
  lines.push(
    "",
    methods,
    "  }",
    "",
    `  Scratch.extensions.register(new ${className}());`,
    "})(Scratch);",
  );
  return lines.join("\n") + "\n";
}
