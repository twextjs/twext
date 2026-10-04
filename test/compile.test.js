import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProduct } from "../src/config.js";
import { loadProject } from "../src/project.js";
import { compileExtension, pascalCase } from "../src/compile.js";
import { validateProject } from "../src/validate.js";

const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function executeExtension(code) {
  global.Scratch = {
    BlockType: {
      COMMAND: "command",
      REPORTER: "reporter",
      BOOLEAN: "boolean",
      HAT: "hat",
      EVENT: "event",
      LOOP: "loop",
      CONDITIONAL: "conditional",
      BUTTON: "button",
      LABEL: "label",
    },
    ArgumentType: {
      STRING: "string",
      NUMBER: "number",
      BOOLEAN: "boolean",
      ANGLE: "angle",
      COLOR: "color",
      MATRIX: "matrix",
      NOTE: "note",
      IMAGE: "image",
      COSTUME: "costume",
      SOUND: "sound",
    },
    extensions: {
      register(ext) {
        global.__registered = ext;
      },
    },
  };
  global.__registered = undefined;
  vm.runInThisContext(code, { filename: "extension.js" });
  return global.__registered;
}

test("compiles the basic fixture into the expected IIFE shape", async () => {
  const product = loadProduct();
  const configPath = join(fixture("basic"), "twext.yml");
  const project = await loadProject(configPath);
  const code = compileExtension(project, product);

  assert.match(code, /^\(function \(Scratch\) \{\n/);
  assert.match(code, /\}\)\(Scratch\);\n$/);
  assert.match(code, /"use strict";/);
  assert.match(code, /const prefix = "\[Super Utilities\]:";/);
  assert.match(code, /class SuperUtilitiesExtension \{/);
  assert.match(code, /Scratch\.extensions\.register\(new SuperUtilitiesExtension\(\)\);/);

  assert.match(code, /opcode: "logMessage",/);
  assert.match(code, /blockType: Scratch\.BlockType\.COMMAND,/);
  assert.match(code, /text: "log \[MESSAGE\] to console",/);
  assert.match(code, /type: Scratch\.ArgumentType\.STRING,/);
  assert.match(code, /defaultValue: "Hello TurboWarp!",/);
  assert.match(code, /defaultValue: 4,/);

  assert.match(code, /logMessage\(args, util\) \{/);
  assert.match(code, /console\.log\(prefix, args\.MESSAGE\);/);
  assert.match(code, /square\(\{ VALUE \}\)/);
  assert.match(code, /const loud = \(text\) => `\$\{text\}!`;/);

  assert.match(code, /blockType: Scratch\.BlockType\.LABEL,/);
  assert.match(code, /text: "Custom Utilities",/);
  assert.doesNotMatch(code, /opcode: (null|undefined),/);
});

test("compiled extension runs and behaves like a real extension", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("basic"), "twext.yml"));
  const code = compileExtension(project, product);

  const extension = executeExtension(code);
  const info = extension.getInfo();
  assert.equal(info.id, "superutilities");
  assert.equal(info.name, "Super Utilities");
  assert.equal(info.color1, "#FF4D4D");
  assert.equal(info.blocks.length, 4);
  assert.equal(info.blocks[0].opcode, "logMessage");
  assert.equal(info.blocks[0].blockType, "command");
  assert.equal(info.blocks[0].arguments.MESSAGE.type, "string");
  assert.equal(info.blocks[0].arguments.MESSAGE.defaultValue, "Hello TurboWarp!");
  assert.equal(info.blocks[1].arguments.VALUE.type, "number");
  assert.equal(info.blocks[3].blockType, "label");
  assert.equal(info.blocks[3].opcode, undefined);
  assert.equal(info.blocks[3].text, "Custom Utilities");

  assert.equal(extension.square({ VALUE: 5 }), 25);
  assert.equal(extension.shout({ THING: "wow" }), "wow!");
  extension.logMessage({ MESSAGE: "hi" });
});

test("getInfo injects null; omitted topics", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("basic"), "twext.yml"));
  const code = compileExtension(project, product);
  assert.doesNotMatch(code, /undefined/);
});

test("omits color2 and color3 when only color1 is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-color-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: colorDemo
  name: "Color Demo"
  color1: "#FF0000"
blocks:
  - opcode: ping
    blockType: reporter
    text: "ping"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      'export const blocks = { ping() { return "pong"; } };\n',
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    assert.doesNotMatch(code, /color2|color3/);
    const info = executeExtension(code).getInfo();
    assert.equal(info.color1, "#FF0000");
    assert.equal(info.color2, undefined);
    assert.equal(info.color3, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expression-bodied setup arrows do not early-return from the IIFE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-setup-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: setupDemo
  name: "Setup Demo"
blocks:
  - opcode: ping
    blockType: reporter
    text: "ping"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      'export const blocks = { ping() { return "pong"; } };\nexport const setup = () => console.log("setup ran");\n',
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    assert.doesNotMatch(code, /\n {2}return console\.log/);
    const info = executeExtension(code).getInfo();
    assert.equal(info.id, "setupDemo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dedent leaves whitespace inside template literals intact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-dedent-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: dedentDemo
  name: "Dedent Demo"
blocks:
  - opcode: block
    blockType: reporter
    text: "block"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      "export const blocks = { block() { return `a\n    b\n  c`; } };\n",
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    const extension = executeExtension(code);
    assert.equal(extension.block({}), "a\n    b\n  c");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate rejects reserved opcodes and non-string text", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: "123"
blocks:
  - opcode: getInfo
    blockType: reporter
    text: 0
  - opcode: constructor
    blockType: reporter
    text: "c"
`,
    "export const blocks = {}\n",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Opcode "getInfo"')));
  assert.ok(result.errors.some((e) => e.includes('Opcode "constructor"')));
  assert.ok(result.errors.some((e) => e.includes("text must be a string")));
});

test("backslash-continued strings keep their whitespace through indentCode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-strcont-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: strContDemo
  name: "Str Cont"
blocks:
  - opcode: block
    blockType: reporter
    text: "block"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      'export const blocks = { block() { return "a\\\n    b"; } };\n',
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    assert.equal(executeExtension(code).block({}), "a    b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pascalCase capitalizes the first character", () => {
  assert.equal(pascalCase("super-utilities"), "SuperUtilities");
  assert.equal(pascalCase("hello world"), "HelloWorld");
  assert.equal(pascalCase("123-tools"), "123Tools");
});

test("compile sanitizes class names derived from numeric-like ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-classname-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: "123-tools"
blocks:
  - opcode: ping
    blockType: reporter
    text: "ping"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      'export const blocks = { ping() { return "pong"; } };\n',
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    assert.match(code, /class _123ToolsExtension \{/);
    assert.doesNotThrow(() => executeExtension(code));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate derives a valid class name for numeric-like ids", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: "123tools"
blocks:
  - opcode: ping
    blockType: reporter
    text: "ping"
`,
    'export const blocks = { ping() { return "pong"; } };\n',
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

async function validateTempProject(yml, index) {
  const dir = mkdtempSync(join(tmpdir(), "twext-validate-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "twext.yml"), yml, "utf8");
    writeFileSync(join(dir, "src", "index.js"), index, "utf8");
    return await validateProject(join(dir, "twext.yml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("validate accepts the basic fixture", async () => {
  const result = await validateProject(join(fixture("basic"), "twext.yml"));
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("validate rejects missing handlers and unknown types", async () => {
  const result = await validateProject(join(fixture("broken"), "twext.yml"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Block "nope"')));
  assert.ok(result.errors.some((e) => e.includes('unknown blockType "imagetype"')));
  assert.ok(result.errors.some((e) => e.includes('unknown type "imaginary"')));
});

test("validate rejects handlers that reference undefined module-scope names", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: refDemo
  name: "Ref Demo"
blocks:
  - opcode: hello
    blockType: reporter
    text: "hello"
`,
    `export const blocks = { hello() { return MISSING_HELPER(); } };\n`,
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Handler "hello" references "MISSING_HELPER"')));
});

test("validate accepts handlers that reference setup names and globals", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: refok
  name: "Ref OK"
blocks:
  - opcode: hello
    blockType: reporter
    text: "hello"
`,
    `export const blocks = { hello() { return COMPUTED + Math.random(); } };
export const setup = \`
  const COMPUTED = 40;
\`;
`,
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("validate rejects non-mapping entries and arguments and inherited type names", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: shapeDemo
  name: "Shape Demo"
blocks:
  - blockType: label
    text: "group"
  - null
  - opcode: bad
    blockType: reporter
    text: "x"
    arguments: []
  - opcode: weird
    blockType: constructor
    text: "y"
    arguments:
      A:
        type: toString
`,
    `export const blocks = { bad() { return 1; }, weird() { return 2; } };\n`,
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Each blocks entry must be a mapping")));
  assert.ok(result.errors.some((e) => e.includes('unknown blockType "constructor"')));
  assert.ok(result.errors.some((e) => e.includes("arguments must be a mapping")));
  assert.ok(result.errors.some((e) => e.includes('unknown type "toString"')));
});

test("compile throws on an unknown blockType", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("broken"), "twext.yml"));
  assert.throws(() => compileExtension(project, product), /Unknown blockType "imagetype"/);
});

test("compiles menus, separators, and labels into getInfo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-menus-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menudemo
  name: "Menu Demo"
  menus:
    FORMAT:
      acceptReporters: true
      items: ["uppercase", "lowercase"]
    SHORTHAND: ["a", "b"]
    OBJECTS:
      acceptReporters: true
      items:
        - text: "Display Uppercase"
          value: "UPPER"
blocks:
  - blockType: label
    text: "Formatting"
  - "---"
  - opcode: convert
    blockType: reporter
    text: "convert [TEXT] to [FORMAT]"
    arguments:
      TEXT:
        type: string
        defaultValue: "Apple"
      FORMAT:
        type: string
        menu: FORMAT
  - opcode: pick
    blockType: reporter
    text: "pick from [OBJECT]"
    arguments:
      OBJECT:
        type: string
        menu: OBJECTS
        defaultValue: "UPPER"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      "export const blocks = { convert({ FORMAT }) { return FORMAT; }, pick({ OBJECT }) { return OBJECT; } };\n",
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const result = await validateProject(join(dir, "twext.yml"));
    assert.equal(result.ok, true, result.errors.join("; "));
    const code = compileExtension(project, loadProduct());
    assert.match(code, /"---",/);
    assert.doesNotMatch(code, /undefined/);

    const info = executeExtension(code).getInfo();
    assert.equal(info.blocks[0].blockType, "label");
    assert.equal(info.blocks[0].text, "Formatting");
    assert.equal(info.blocks[1], "---");
    assert.equal(info.blocks[2].arguments.FORMAT.menu, "FORMAT");
    assert.equal(info.menus.FORMAT.acceptReporters, true);
    assert.deepEqual(info.menus.FORMAT.items, ["uppercase", "lowercase"]);
    assert.deepEqual(info.menus.SHORTHAND, { items: ["a", "b"] });
    assert.equal(info.menus.OBJECTS.acceptReporters, true);
    assert.deepEqual(info.menus.OBJECTS.items, [{ text: "Display Uppercase", value: "UPPER" }]);
    assert.equal(executeExtension(code).convert({ FORMAT: "uppercase" }), "uppercase");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate accepts menus and separators", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menuok
  menus:
    LEVEL:
      acceptReporters: true
      items: ["info", "warn"]
    MODE: ["a", "b"]
blocks:
  - "---"
  - blockType: label
    text: "Heading"
  - opcode: log
    blockType: command
    text: "log [LEVEL]"
    arguments:
      LEVEL:
        type: string
        menu: LEVEL
`,
    "export const blocks = { log() {} };\n",
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("validate rejects unknown menus and non-separator strings", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menuErr
  menus:
    KNOWN: ["x"]
blocks:
  - "---"
  - "Not a separator"
  - opcode: one
    blockType: reporter
    text: "one"
    arguments:
      A:
        type: string
        menu: MISSING
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Blocks entry "Not a separator"')));
  assert.ok(result.errors.some((e) => e.includes('references unknown menu "MISSING"')));
});

test("validate rejects malformed menus", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menuBad
  menus:
    A:
      items: 42
    B:
      acceptReporters: "yes"
    C: 42
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Menu "A" items must be an array')));
  assert.ok(result.errors.some((e) => e.includes('Menu "B" acceptReporters must be a boolean')));
  assert.ok(
    result.errors.some((e) => e.includes('Menu "C" must be a list of items, a mapping, or the')),
  );
});

test("validate rejects menus without items and items missing text or value", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menuFields
  menus:
    NOITEMS:
      acceptReporters: true
    NOTEXT:
      items:
        - value: "x"
    NOVALUE:
      items:
        - text: "x"
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) =>
      e.includes('Menu "NOITEMS" must define items or be a plain list of items'),
    ),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Menu "NOTEXT" item text and value must be strings')),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Menu "NOVALUE" item text and value must be strings')),
  );
});

test("validate accepts object menu items with both text and value", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: menugood
  menus:
    CHOICES:
      items:
        - text: "One"
          value: "1"
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
    arguments:
      C:
        type: string
        menu: CHOICES
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

async function compileTempProject(yml, index) {
  const dir = mkdtempSync(join(tmpdir(), "twext-compile-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "twext.yml"), yml, "utf8");
    writeFileSync(join(dir, "src", "index.js"), index, "utf8");
    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    return { code, extension: executeExtension(code) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("extension, block, and argument fields all reach getInfo", async () => {
  const { extension } = await compileTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: passthru
  name: "Passthru"
  docsURI: "https://example.com/docs"
  menuIconURI: "https://example.com/menu.svg"
  blockIconURI: "https://example.com/button.svg"
blocks:
  - opcode: whenFlag
    blockType: hat
    text: "when flag clicked"
    isEdgeActivated: true
    shouldRestartExistingThreads: true
  - blockType: label
    text: "Group"
  - opcode: load
    blockType: command
    text: "load [IMAGE]"
    isTerminal: true
    disableMonitor: false
    hideFromPalette: true
    blockIconURI: "https://example.com/block.svg"
    filter: ["sprite"]
    arguments:
      IMAGE:
        type: image
        dataURI: "data:image/png;base64,AAA"
        flipRTL: true
  - opcode: ifThen
    blockType: cond
    text: "if [X] then"
    branchCount: 2
    arguments:
      X:
        type: boolean
`,
    `export const blocks = {
  whenFlag() {},
  load() {},
  ifThen() {},
};
`,
  );
  const info = extension.getInfo();
  assert.equal(info.docsURI, "https://example.com/docs");
  assert.equal(info.menuIconURI, "https://example.com/menu.svg");
  assert.equal(info.blockIconURI, "https://example.com/button.svg");

  const [hat, label, load, cond] = info.blocks;
  assert.equal(hat.isEdgeActivated, true);
  assert.equal(hat.shouldRestartExistingThreads, true);
  assert.deepEqual(Object.keys(label), ["blockType", "text"]);
  assert.equal(load.isTerminal, true);
  assert.equal(load.disableMonitor, false);
  assert.equal(load.hideFromPalette, true);
  assert.equal(load.blockIconURI, "https://example.com/block.svg");
  assert.deepEqual(load.filter, ["sprite"]);
  assert.equal(load.arguments.IMAGE.type, "image");
  assert.equal(load.arguments.IMAGE.dataURI, "data:image/png;base64,AAA");
  assert.equal(load.arguments.IMAGE.flipRTL, true);
  assert.equal(cond.branchCount, 2);
});

test("labels never gain executable-block fields", async () => {
  const { extension } = await compileTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: labelonly
blocks:
  - blockType: label
    text: "Group"
`,
    "export const blocks = {};\n",
  );
  assert.deepEqual(extension.getInfo().blocks, [{ blockType: "label", text: "Group" }]);
});

test("dynamic menus resolve through the methods export", async () => {
  const { extension } = await compileTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: dynmenus
  menus:
    SHORT: shortItems
    LONG:
      acceptReporters: true
      items: longItems
blocks:
  - opcode: pick
    blockType: reporter
    text: "pick [CHOICE]"
    arguments:
      CHOICE:
        type: string
        menu: SHORT
`,
    `export const blocks = { pick(args) { return args.CHOICE; } };
export const methods = {
  shortItems() { return ["a", "b"]; },
  longItems() { return [{ text: "One", value: "1" }]; },
};
`,
  );
  const info = extension.getInfo();
  assert.deepEqual(info.menus.SHORT, { items: "shortItems" });
  assert.deepEqual(info.menus.LONG, { items: "longItems", acceptReporters: true });
  assert.deepEqual(extension.shortItems(), ["a", "b"]);
  assert.deepEqual(extension.longItems(), [{ text: "One", value: "1" }]);
});

test("buttons dispatch to a method and func renames a block's method", async () => {
  const { extension } = await compileTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: buttons
blocks:
  - blockType: button
    text: "make it"
    func: MAKE_IT
    filter: ["stage"]
  - opcode: doThing
    func: publishDoThing
    blockType: command
    text: "do the thing"
`,
    `export const blocks = { doThing() { return "did"; } };
export const methods = { MAKE_IT() { return "clicked"; } };
`,
  );
  const info = extension.getInfo();
  assert.deepEqual(info.blocks[0], {
    blockType: "button",
    text: "make it",
    func: "MAKE_IT",
    filter: ["stage"],
  });
  assert.equal(extension.MAKE_IT(), "clicked");
  assert.equal(extension.publishDoThing(), "did");
  assert.equal(extension.doThing, undefined);
});

test("validate rejects unknown manifest fields instead of dropping them", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: strictdemo
  docURI: "https://example.com"
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
    isTermnal: true
    arguments:
      A:
        type: string
        dataUri: "x"
  - blockType: label
    text: "Nope"
    opcode: sneaky
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('extension has unknown field "docURI"')),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) =>
      e.includes('Block "one" has unknown field "isTermnal"; did you mean "isTerminal"'),
    ),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Block "one" argument "A" has unknown field "dataUri"')),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Block label "Nope" has unknown field "opcode"')),
    result.errors.join("; "),
  );
});

test("validate requires event blocks to opt out of edge activation", async () => {
  const missing = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: events
blocks:
  - opcode: onEvent
    blockType: event
    text: "when something happens"
`,
    "export const blocks = { onEvent() {} };\n",
  );
  assert.equal(missing.ok, false);
  assert.ok(
    missing.errors.some((e) =>
      e.includes('Block "onEvent" is an event block, which needs "isEdgeActivated: false"'),
    ),
    missing.errors.join("; "),
  );

  const opted = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: eventsok
blocks:
  - opcode: onEvent
    blockType: event
    text: "when something happens"
    isEdgeActivated: false
`,
    "export const blocks = { onEvent() {} };\n",
  );
  assert.equal(opted.ok, true, opted.errors.join("; "));
});

test("validate warns when an edge-activated hat also restarts threads", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: edgewarn
blocks:
  - opcode: whenKey
    blockType: hat
    text: "when key pressed"
    isEdgeActivated: true
    shouldRestartExistingThreads: true
`,
    "export const blocks = { whenKey() {} };\n",
  );
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.ok(
    result.warnings.some((w) => w.includes('Block "whenKey" restarts existing threads')),
    result.warnings.join("; "),
  );
});

test("validate type-checks passthrough fields", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: types
  docsURI: 7
  menus:
    A: ["x"]
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
    isTerminal: "yes"
    filter: ["sprite", "backdrop"]
    branchCount: 0
    arguments:
      A:
        type: string
        menu: A
        flipRTL: "yes"
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("extension.docsURI must be a string")));
  assert.ok(result.errors.some((e) => e.includes('Block "one" isTerminal must be a boolean')));
  assert.ok(
    result.errors.some((e) => e.includes('Block "one" filter entries must be "sprite" or "stage"')),
  );
  assert.ok(result.errors.some((e) => e.includes('Block "one" branchCount must be a whole')));
  assert.ok(result.errors.some((e) => e.includes('argument "A" flipRTL must be a boolean')));
});

test("validate requires a dataURI on image, costume, and sound arguments", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: assets
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
    arguments:
      A:
        type: sound
      B:
        type: costume
        dataURI: "data:image/png;base64,AAA"
      C:
        type: image
        dataURI: 42
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('argument "A" is type "sound" and needs a dataURI')),
    result.errors.join("; "),
  );
  assert.ok(!result.errors.some((e) => e.includes('argument "B"')), result.errors.join("; "));
  assert.ok(
    result.errors.some((e) => e.includes('argument "C" dataURI must be a string')),
    result.errors.join("; "),
  );
});

test("validate checks dynamic menus, buttons, and the methods export", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: dynbad
  menus:
    MISSING: noSuchMethod
    ALSO_MISSING:
      items: alsoMissing
blocks:
  - blockType: button
    text: "go"
    func: notExported
  - blockType: button
    text: "no func"
`,
    `export const blocks = {};
export const methods = { helper: 1, getInfo() {} };
`,
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) =>
      e.includes('Menu "MISSING" is dynamic, but no method named "noSuchMethod"'),
    ),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) =>
      e.includes('Menu "ALSO_MISSING" is dynamic, but no method named "alsoMissing"'),
    ),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Block button "go" has no method named "notExported"')),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) => e.includes('Block button "no func" must call a method')),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) =>
      e.includes('Method "helper" in the "methods" export is not a function'),
    ),
    result.errors.join("; "),
  );
  assert.ok(
    result.errors.some((e) =>
      e.includes('Method "getInfo" conflicts with a generated extension method'),
    ),
    result.errors.join("; "),
  );
});

test("validate applies free-variable rules to methods", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: methodrefs
  menus:
    A: menuItems
blocks:
  - opcode: one
    blockType: reporter
    text: "one"
`,
    `export const blocks = {};
export const methods = { menuItems() { return MISSING_HELPER(); } };
`,
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('Method "menuItems" references "MISSING_HELPER"')),
    result.errors.join("; "),
  );
});

test("validate rejects a func that collides with a generated method", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: funcbad
blocks:
  - opcode: one
    func: getInfo
    blockType: reporter
    text: "one"
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) =>
      e.includes('Func "getInfo" conflicts with a generated extension method'),
    ),
    result.errors.join("; "),
  );
});

test("validate rejects a block func that collides with a shared method", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: collide
blocks:
  - opcode: one
    func: helper
    blockType: reporter
    text: "one"
`,
    `export const blocks = { one() { return 1; } };
export const methods = { helper() { return 2; } };
`,
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) =>
      e.includes('Block "one" publishes method "helper", which is already in the "methods" export'),
    ),
    result.errors.join("; "),
  );
});

test("validate rejects blocks that publish the same method name", async (t) => {
  const cases = [
    { name: "two func values", firstFunc: "shared", secondFunc: "shared", method: "shared" },
    { name: "func before opcode", firstFunc: "two", method: "two" },
    { name: "opcode before func", secondFunc: "one", method: "one" },
  ];
  for (const { name, firstFunc, secondFunc, method } of cases) {
    await t.test(name, async () => {
      const result = await validateTempProject(
        `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: collide
blocks:
  - opcode: one
    blockType: reporter
${firstFunc ? `    func: ${firstFunc}\n` : ""}  - opcode: two
    blockType: reporter
${secondFunc ? `    func: ${secondFunc}\n` : ""}`,
        "export const blocks = { one() { return 1; }, two() { return 2; } };\n",
      );
      assert.equal(result.ok, false);
      assert.deepEqual(result.errors, [`Duplicate published method "${method}" in blocks`]);
    });
  }
});

test("validate rejects duplicate opcodes even with distinct func values", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: duplicate
blocks:
  - opcode: one
    func: first
    blockType: reporter
  - opcode: one
    func: second
    blockType: reporter
`,
    "export const blocks = { one() { return 1; } };\n",
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Duplicate opcode "one" in blocks']);
});

test("validate accepts distinct published names when func reuses a renamed opcode", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: renamed
blocks:
  - opcode: one
    func: renamedOne
    blockType: reporter
  - opcode: two
    func: one
    blockType: reporter
`,
    "export const blocks = { one() { return 1; }, two() { return 2; } };\n",
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("a button can only name a method that is actually compiled", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: orphanbtn
blocks:
  - blockType: button
    text: "go"
    func: makeVariable
`,
    `export const blocks = { makeVariable() {} };
`,
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('Block button "go" has no method named "makeVariable"')),
    result.errors.join("; "),
  );
});

test("a button can name a declared block's handler", async () => {
  const result = await validateTempProject(
    `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: sharedbtn
blocks:
  - opcode: reset
    blockType: command
    text: "reset"
  - blockType: button
    text: "reset"
    func: reset
`,
    "export const blocks = { reset() {} };\n",
  );
  assert.equal(result.ok, true, result.errors.join("; "));
});
