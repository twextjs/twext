import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadProduct } from "../src/config.js";
import { readProjectConfig } from "../src/project.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("loadProduct reads product.yml", () => {
  const product = loadProduct();
  assert.equal(product.name, "Twext");
  assert.equal(product.symbols.success, "✓");
  assert.equal(product.defaults.fallbackColor, "#0070F3");
  assert.equal(product.defaults.devPort, 8000);
});

test("readProjectConfig parses nested mappings and block lists", () => {
  const config = readProjectConfig(join(root, "test-fixtures", "basic", "twext.yml"));
  assert.equal(config.entryPoint, "src/index.js");
  assert.equal(config.extension.className, "SuperUtilitiesExtension");
  assert.equal(config.blocks.length, 4);
  assert.equal(config.blocks[3].blockType, "label");
  assert.equal(config.blocks[0].arguments.MESSAGE.defaultValue, "Hello TurboWarp!");
  assert.equal(config.blocks[1].arguments.VALUE.defaultValue, 4);
});

test("readProjectConfig reports a missing file", () => {
  assert.throws(() => readProjectConfig(join(root, "does-not-exist.yml")), /Could not read config/);
});

test("readProjectConfig treats an empty file as an empty config", () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-config-"));
  try {
    const file = join(dir, "twext.yml");
    writeFileSync(file, "", "utf8");
    assert.deepEqual(readProjectConfig(file), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
