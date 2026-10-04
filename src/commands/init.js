import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

function templateYml(fallbackColor) {
  return `name: "my-extension"
version: "0.1.0"
description: ""
author: ""
license: "MIT"

entryPoint: "src/index.js"
outputPath: "dist/extension.js"

extension:
  id: "myextension"
  name: "My Extension"
  className: "MyExtension"
  color1: "${fallbackColor}"
  color2: "${fallbackColor}"
  color3: "${fallbackColor}"

blocks:
  - opcode: hello
    blockType: reporter
    text: "say hello"
`;
}

function templateIndex() {
  return `import { hello } from "./blocks/hello.js";

export const blocks = {
  hello,
};

export function setup() {
  console.log("[my-extension] loaded");
}
`;
}

function templateHello() {
  return `export function hello(args, util) {
  return "Hello TurboWarp!";
}
`;
}

const FILES = {
  "twext.yml": (product) => templateYml(product.defaults.fallbackColor ?? "#0070F3"),
  "src/index.js": () => templateIndex(),
  "src/blocks/hello.js": () => templateHello(),
};

function parentDirs(dir, rel) {
  const out = [];
  let parent = dirname(join(dir, rel));
  while (parent !== dir) {
    out.push(parent);
    parent = dirname(parent);
  }
  return out;
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function initCommand(product, target, force, log) {
  const dir = resolve(target ?? ".");
  let existing = dir;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!statSync(existing).isDirectory()) {
    log.error(`${relative(process.cwd(), existing)} exists and is not a directory`);
    return false;
  }
  const conflicts = [];
  for (const rel of Object.keys(FILES)) {
    if (existsSync(join(dir, rel)) && !force) conflicts.push(rel);
  }
  const blockedParents = new Set();
  for (const rel of Object.keys(FILES)) {
    for (const parent of parentDirs(dir, rel)) {
      if (existsSync(parent) && !statSync(parent).isDirectory()) blockedParents.add(parent);
    }
  }
  if (conflicts.length > 0 || blockedParents.size > 0) {
    for (const rel of conflicts)
      log.error(`${relative(process.cwd(), resolve(dir, rel))} already exists`);
    for (const parent of blockedParents)
      log.error(`${relative(process.cwd(), parent)} exists and is not a directory`);
    if (conflicts.length > 0) log.info(`Use -f to overwrite existing files.`);
    return false;
  }
  const root = resolve(dir);
  if (isSymlink(root)) {
    log.error(`${relative(process.cwd(), root)} is a symbolic link and was rejected`);
    return false;
  }
  for (const rel of Object.keys(FILES)) {
    const output = resolve(root, rel);
    const relToRoot = relative(root, output);
    if (relToRoot !== "" && (relToRoot === ".." || relToRoot.startsWith(`..${sep}`))) {
      log.error(
        `${relative(process.cwd(), output)} resolves outside ${relative(process.cwd(), root)}`,
      );
      return false;
    }
    let component = root;
    for (const part of relToRoot.split(sep)) {
      if (part === "") continue;
      component = join(component, part);
      if (isSymlink(component)) {
        log.error(`${relative(process.cwd(), component)} is a symbolic link and was rejected`);
        return false;
      }
    }
  }
  mkdirSync(dir, { recursive: true });
  for (const [rel, render] of Object.entries(FILES)) {
    const output = resolve(root, rel);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, render(product), "utf8");
    log.bullet(relative(process.cwd(), output));
  }
  log.success(`Initialized ${dir}`);
  return true;
}
