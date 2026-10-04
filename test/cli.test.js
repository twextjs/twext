import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "twext-project-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("init scaffolds a project that builds", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const init = runCli(["init"], dir);
    assert.equal(init.status, 0);
    for (const file of ["twext.yml", "src/index.js", "src/blocks/hello.js"]) {
      assert.ok(existsSync(join(dir, file)), `${file} should exist`);
    }

    const validate = runCli(["validate"], dir);
    assert.equal(validate.status, 0, validate.stderr);
    assert.match(validate.stdout, /1 block validated/);

    const build = runCli(["build"], dir);
    assert.equal(build.status, 0, build.stderr);
    const out = join(dir, "dist", "extension.js");
    assert.ok(existsSync(out));
    const code = readFileSync(out, "utf8");
    assert.match(code, /class MyExtension \{/);
    assert.match(code, /opcode: "hello",/);

    assert.equal(runCli(["init"], dir).status, 1, "init refuses to overwrite");
    assert.equal(runCli(["init", "-f"], dir).status, 0, "init -f overwrites");
  } finally {
    cleanup();
  }
});

test("init refuses to run when a template parent path is a file", () => {
  const { dir, cleanup } = tmpProject();
  try {
    writeFileSync(join(dir, "src"), "not a directory", "utf8");
    const result = runCli(["init", "-f"], dir);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not a directory/);
    assert.ok(!existsSync(join(dir, "twext.yml")), "no files should be written");
  } finally {
    cleanup();
  }
});

test("init refuses a target under an existing-file ancestor", () => {
  const { dir, cleanup } = tmpProject();
  try {
    writeFileSync(join(dir, "sub"), "not a directory", "utf8");
    const result = runCli(["init", "sub/proj"], dir);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not a directory/);
    assert.ok(!existsSync(join(dir, "sub", "proj", "twext.yml")), "no files should be written");
  } finally {
    cleanup();
  }
});

test("validate rejects a broken project and exits nonzero", () => {
  const result = runCli(["validate"], fixture("broken"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /✗ Block "nope"/);
});

test("build without a config exits nonzero with a helpful error", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const result = runCli(["build"], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not read config/);
  } finally {
    cleanup();
  }
});

test("build writes to an explicit -o path", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const out = join(dir, "bundled.js");
    const result = runCli(["build", "-o", out], fixture("basic"));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(out));
    const code = readFileSync(out, "utf8");
    assert.match(code, /class SuperUtilitiesExtension \{/);
  } finally {
    cleanup();
  }
});

test("the default command is build", () => {
  const { dir, cleanup } = tmpProject();
  try {
    runCli(["init"], dir);
    const result = runCli([], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, "dist", "extension.js")));
  } finally {
    cleanup();
  }
});

test("unknown commands fail and --version prints the version", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    assert.equal(runCli(["frobnicate"], dir).status, 1);
    const version = runCli(["--version"], dir);
    assert.equal(version.status, 0);
  } finally {
    cleanup();
  }
});
