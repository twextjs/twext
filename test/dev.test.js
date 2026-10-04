import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function initProject() {
  const dir = mkdtempSync(join(tmpdir(), "twext-dev-"));
  const init = spawnSync(process.execPath, [cli, "init"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

function startDev(dir, port = "0") {
  const child = spawn(process.execPath, [cli, "dev", "--port", port], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => (state.stdout += chunk));
  child.stderr.on("data", (chunk) => (state.stderr += chunk));
  const served = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`dev never served a URL\n${state.stdout}${state.stderr}`)),
      20000,
    );
    const look = () => {
      const match = state.stdout.match(/Serving (http:\/\/\S+?)\/extension\.js/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", look);
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`dev exited with ${code}\n${state.stdout}${state.stderr}`));
    });
  });
  return { child, state, served };
}

function stopDev(dev) {
  return new Promise((resolve) => {
    if (dev.child.exitCode !== null) {
      resolve();
      return;
    }
    dev.child.once("close", () => resolve());
    dev.child.kill("SIGINT");
    setTimeout(() => dev.child.kill("SIGKILL"), 3000).unref();
  });
}

async function waitFor(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(message);
}

async function body(url) {
  return (await fetch(url)).text();
}

test("dev serves the extension with the headers TurboWarp's server sends", async () => {
  const dir = initProject();
  const dev = startDev(dir);
  try {
    const url = await dev.served;
    const response = await fetch(`${url}/extension.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/javascript; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");

    const extension = await response.text();
    assert.match(extension, /class MyExtension \{/);
    assert.match(extension, /Hello TurboWarp!/);

    const index = await fetch(url);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /My Extension/);
    assert.equal((await fetch(`${url}/does-not-exist`)).status, 404);
  } finally {
    await stopDev(dev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev rebuilds when an imported handler changes", async () => {
  const dir = initProject();
  const dev = startDev(dir);
  try {
    const url = await dev.served;
    assert.match(await body(`${url}/extension.js`), /Hello TurboWarp!/);

    writeFileSync(
      join(dir, "src/blocks/hello.js"),
      'export function hello() {\n  return "Edited.";\n}\n',
    );
    await waitFor(
      async () => (await body(`${url}/extension.js`)).includes("Edited."),
      `the edit never reached the server\n${dev.state.stdout}${dev.state.stderr}`,
    );
  } finally {
    await stopDev(dev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev keeps the last good build through a failure and picks up the fix", async () => {
  const dir = initProject();
  const dev = startDev(dir);
  try {
    const url = await dev.served;
    assert.match(await body(`${url}/extension.js`), /Hello TurboWarp!/);

    writeFileSync(join(dir, "src/blocks/hello.js"), "export function hello( {\n");
    await waitFor(
      async () => dev.state.stderr.includes("Build failed"),
      `the failure was never reported\n${dev.state.stdout}${dev.state.stderr}`,
    );
    assert.match(
      await body(`${url}/extension.js`),
      /Hello TurboWarp!/,
      "the last good build should still be served",
    );

    writeFileSync(
      join(dir, "src/blocks/hello.js"),
      'export function hello() {\n  return "Recovered.";\n}\n',
    );
    await waitFor(
      async () => (await body(`${url}/extension.js`)).includes("Recovered."),
      `the fix never reached the server\n${dev.state.stdout}${dev.state.stderr}`,
    );
  } finally {
    await stopDev(dev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev refuses a port that is already in use", async () => {
  const dir = initProject();
  const busy = createServer(() => {});
  await new Promise((listening) => busy.listen(0, "127.0.0.1", listening));
  try {
    const port = busy.address().port;
    const result = spawnSync(process.execPath, [cli, "dev", "--port", String(port)], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /in use/);
  } finally {
    busy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
