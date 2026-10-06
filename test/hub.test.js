import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { Header } from "tar";
import { checkoutCommand } from "../src/commands/checkout.js";
import { HubError, getVersion, downloadSource } from "../src/hub.js";
import { isRange } from "../src/spec.js";

import { createProjectTarball } from "../src/tarball.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function runCli(args, { env, cwd, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function createHub(routes) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] ?? null;
    const [path, query = ""] = req.url.split("?");
    const request = {
      method: req.method,
      path,
      query,
      authorization: req.headers.authorization ?? null,
      contentType,
      raw,
      body: contentType?.includes("application/json") && raw.length > 0 ? JSON.parse(raw) : null,
    };
    requests.push(request);
    const route = routes.find((r) => r.method === request.method && r.path === request.path);
    const reply =
      typeof route?.reply === "function"
        ? route.reply(request)
        : (route?.reply ?? { status: 404, body: { title: "Not Found" } });
    if (reply.status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(reply.status, { "content-type": reply.contentType ?? "application/json" });
    res.end(
      Buffer.isBuffer(reply.body)
        ? reply.body
        : reply.body === undefined
          ? ""
          : JSON.stringify(reply.body),
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

const termsProblem = {
  status: 403,
  body: { detail: "The current Terms of Service have not been accepted yet." },
};

// Entry names and bytes out of the gzipped tarball a publish uploads.
function tarEntries(gzip) {
  const raw = gunzipSync(gzip);
  const entries = [];
  for (let offset = 0; offset + 512 <= raw.length;) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) =>
      header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 136).trim() || "0", 8);
    entries.push({ name: field(0, 100), data: raw.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tmpHome() {
  const dir = mkdtempSync(join(tmpdir(), "twext-home-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("login stores credentials and publish auto-accepts terms with a session token", async () => {
  const { dir, cleanup } = tmpHome();
  let publishAttempts = 0;
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: {
        status: 201,
        body: {
          session: { id: "s-1" },
          token: "sess-1",
          user: { namespace: "acme", role: "normal" },
        },
      },
    },
    {
      method: "GET",
      path: "/terms",
      reply: {
        status: 200,
        body: { version: 3, body: "Be kind.", updatedAt: "2026-01-01T00:00:00Z" },
      },
    },
    {
      method: "PATCH",
      path: "/users/acme",
      reply: (request) => ({
        status: 200,
        body: { namespace: "acme", termsAcceptedVersion: request.body.termsAcceptedVersion },
      }),
    },
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: (request) => {
        if (request.authorization !== "Bearer sess-1") return termsProblem;
        if (++publishAttempts === 1) return termsProblem;
        return {
          status: 201,
          body: {
            namespace: "acme",
            id: "superutilities",
            version: "1.0.0",
            status: "published",
            dist: { downloadUrl: "https://hub.test/x.js" },
          },
        };
      },
    },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stdout, /Logged in as acme/);

    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.deepEqual(config, { hub: hub.url, namespace: "acme", token: "sess-1" });

    const loginRequestsBeforePublish = hub.requests.filter((r) => r.path === "/sessions").length;

    const publish = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      { env: { HOME: dir } },
    );
    assert.equal(publish.code, 0, publish.stderr);
    assert.match(publish.stdout, /Published superutilities@1\.0\.0/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/sessions").length,
      loginRequestsBeforePublish,
      "no new login on publish",
    );
    assert.equal(hub.requests.filter((r) => r.path === "/terms").length, 1, "terms read once");
    const acceptance = hub.requests.find((r) => r.method === "PATCH");
    assert.equal(acceptance.path, "/users/acme");
    assert.deepEqual(acceptance.body, { termsAcceptedVersion: 3 });
    const publishes = hub.requests.filter((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(publishes.length, 2, "re-published after accepting terms");
    assert.equal(publishes[0].authorization, "Bearer sess-1");
    assert.equal(publishes[1].authorization, "Bearer sess-1");
    for (const publish of publishes) assert.equal(publish.contentType, "application/gzip");
    const packed = tarEntries(publishes[1].raw);
    for (const name of [
      "twext.yml",
      "package.json",
      "src/index.js",
      "src/blocks/messaging.js",
      "src/blocks/more.js",
    ]) {
      assert.ok(
        packed.some((entry) => entry.name === name),
        `${name} should be packed`,
      );
    }
    assert.match(
      packed.find((entry) => entry.name === "twext.yml").data.toString("utf8"),
      /super-utilities/,
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login reports rejected credentials without signing up", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: { status: 401, body: { detail: "Invalid namespace or password" } },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "newbie", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid namespace or password/);
    assert.match(result.stdout, /Run twext signup/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/users").length,
      0,
      "never signs up implicitly",
    );
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("stored credentials are only used for the hub they were saved for", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: "https://a.test/v1", namespace: "acme", token: "tok-a" }),
    );
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveToken(undefined, "https://a.test/v1", {}),
        resolveNamespace(undefined, "https://a.test/v1", {}),
        resolveToken(undefined, "https://b.test/v1", {}),
        resolveNamespace(undefined, "https://b.test/v1", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "tok-a|acme||");
  } finally {
    cleanup();
  }
});

test("hub URLs are canonicalized before they are stored or compared", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: {
        status: 201,
        body: {
          session: { id: "s-1" },
          token: "sess-1",
          user: { namespace: "acme", role: "normal" },
        },
      },
    },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", `${hub.url}/`, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 0, login.stderr);
    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.equal(config.hub, hub.url, "trailing slash is stripped before storing");
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveHubUrl, resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveHubUrl("${hub.url}/", {}),
        resolveToken(undefined, "${hub.url}", {}),
        resolveNamespace(undefined, "${hub.url}", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${hub.url}|sess-1|acme`);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("stored hub URLs with trailing slashes still match canonical lookups", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: "https://a.test/v1/", namespace: "acme", token: "tok-a" }),
    );
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveToken(undefined, "https://a.test/v1", {}),
        resolveNamespace(undefined, "https://a.test/v1", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "tok-a|acme");
  } finally {
    cleanup();
  }
});

test("hub URLs must be HTTPS or loopback", async () => {
  const { dir, cleanup } = tmpHome();
  try {
    const result = await runCli(
      ["login", "--url", "http://example.com", "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Refusing to send credentials/);
  } finally {
    cleanup();
  }
});

test("hub requests reject redirects so password bodies are never replayed", async () => {
  const { dir, cleanup } = tmpHome();
  let replayed = false;
  const target = createServer((req, res) => {
    replayed = true;
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  let targetPort;
  const source = createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/sessions` });
    res.end();
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = target.address().port;
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runCli(
      [
        "login",
        "--url",
        `http://127.0.0.1:${source.address().port}`,
        "--namespace",
        "acme",
        "--password",
        "pw",
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Could not reach the hub/);
    assert.equal(replayed, false, "redirect target must never receive the request");
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await new Promise((resolve) => target.close(resolve));
    await new Promise((resolve) => source.close(resolve));
  }
});

test("login tightens permissions on an existing config file", async () => {
  const { dir, cleanup } = tmpHome();
  const cfgDir = join(dir, ".twext");
  const cfgFile = join(cfgDir, "config.json");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(cfgFile, "{}\n");
  chmodSync(cfgFile, 0o644);
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: {
        status: 201,
        body: {
          session: { id: "s-1" },
          token: "sess-1",
          user: { namespace: "acme", role: "normal" },
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(statSync(cfgFile).mode & 0o777, 0o600);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup creates an account and stores the session", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/users",
      reply: {
        status: 201,
        body: {
          session: { id: "s-3" },
          token: "sess-3",
          user: { namespace: "alice", role: "normal" },
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      [
        "signup",
        "--url",
        hub.url,
        "--namespace",
        "alice",
        "--password",
        "longpass",
        "--display-name",
        "Alice",
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Signed up as alice/);
    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.deepEqual(config, { hub: hub.url, namespace: "alice", token: "sess-3" });
    const request = hub.requests.find((r) => r.path === "/users");
    assert.deepEqual(request.body, {
      namespace: "alice",
      password: "longpass",
      displayName: "Alice",
    });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup omits displayName and flags admin accounts", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/users",
      reply: {
        status: 201,
        body: {
          session: { id: "s-4" },
          token: "sess-4",
          user: { namespace: "root", role: "admin" },
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "root", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /admin/);
    const request = hub.requests.find((r) => r.path === "/users");
    assert.deepEqual(request.body, { namespace: "root", password: "longpass" });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup reports a taken namespace without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/users",
      reply: { status: 409, body: { detail: "That namespace is already taken." } },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "taken", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already taken/);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login fails on a malformed response without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: { status: 200, body: { ok: true } },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /invalid login response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup fails on a malformed response without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/users",
      reply: { status: 201, body: { token: "sess-4" } },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "alice", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /invalid signup response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login and signup treat an empty successful body as an invalid response", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    { method: "POST", path: "/sessions", reply: { status: 200 } },
    { method: "POST", path: "/users", reply: { status: 201 } },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 1, login.stderr);
    assert.match(login.stderr, /invalid login response/i);

    const signup = await runCli(
      ["signup", "--url", hub.url, "--namespace", "alice", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(signup.code, 1, signup.stderr);
    assert.match(signup.stderr, /invalid signup response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("resolveHubUrl falls back to the public hub", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveHubUrl } from ${JSON.stringify(hubModule)};
      console.log([
        resolveHubUrl(undefined, {}),
        resolveHubUrl(undefined, { TWEXTHUB_URL: "https://example.com/v1" }),
        resolveHubUrl("https://custom.test", {}),
      ].join(" "));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      "https://twexts.sdisk.us/api/v1 https://example.com/v1 https://custom.test",
    );
  } finally {
    cleanup();
  }
});

test("logout forgets the stored credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/sessions",
      reply: {
        status: 201,
        body: {
          session: { id: "s-1" },
          token: "sess-1",
          user: { namespace: "acme", role: "normal" },
        },
      },
    },
    { method: "DELETE", path: "/sessions/current", reply: { status: 204 } },
  ]);
  try {
    await runCli(["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"], {
      env: { HOME: dir },
    });
    assert.ok(existsSync(join(dir, ".twext", "config.json")));
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.match(logout.stdout, /Logged out/);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
    const revoke = hub.requests.find((r) => r.path === "/sessions/current");
    assert.equal(revoke.authorization, "Bearer sess-1", "session revoked at the hub");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("logout revokes an automation token with the token's own route", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "DELETE",
      path: "/sessions/current",
      reply: {
        status: 403,
        body: { detail: "Automation tokens cannot access this endpoint." },
      },
    },
    { method: "DELETE", path: "/tokens/current", reply: { status: 204 } },
  ]);
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: hub.url, namespace: "acme", token: "auto-tok" }),
    );
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.match(logout.stdout, /Logged out/);
    assert.ok(!existsSync(join(cfgDir, "config.json")));
    const revoke = hub.requests.find((r) => r.path === "/tokens/current");
    assert.equal(revoke.authorization, "Bearer auto-tok");
    assert.equal(logout.stderr, "", "no warning when the token is revoked");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("logout forgets the credentials even when the hub cannot be reached", async () => {
  const { dir, cleanup } = tmpHome();
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: "http://127.0.0.1:1", namespace: "acme", token: "sess-1" }),
    );
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.match(logout.stdout, /Logged out/);
    assert.match(logout.stderr, /Could not revoke the session/);
    assert.ok(!existsSync(join(cfgDir, "config.json")));
  } finally {
    cleanup();
  }
});

test("publish fails when terms gate blocks an automation token", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 403,
        body: {
          detail: "The current Terms of Service have not been accepted yet.",
          title: "Terms of Service not accepted",
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Accept the terms with a session \(twext login\) before publishing again/,
    );
    assert.equal(
      hub.requests.filter((r) => r.path === "/terms" || r.method === "PATCH").length,
      0,
      "never accepts terms with an automation token",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("yank sends a DELETE for the published version", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "DELETE",
      path: "/@acme/superutilities/versions/1.0.0",
      reply: { status: 204 },
    },
  ]);
  try {
    const result = await runCli(
      ["yank", "1.0.0", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Yanked superutilities@1\.0\.0/);
    const yank = hub.requests.find((r) => r.method === "DELETE");
    assert.ok(yank, "DELETE request sent");
    assert.equal(yank.authorization, "Bearer auto-tok");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("yank refuses an extension.id that is not a safe path segment", async () => {
  const { dir, cleanup } = tmpHome();
  const configPath = join(dir, "twext.yml");
  writeFileSync(configPath, "extension:\n  id: foo/bar\n", "utf8");
  try {
    const result = await runCli(
      ["yank", "1.0.0", "--config", configPath, "--url", "https://hub.test"],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /extension\.id "foo\/bar" is invalid/);
  } finally {
    cleanup();
  }
});

test("token create sends scopes and prints the token once", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/tokens",
      reply: {
        status: 201,
        body: {
          id: "tok-1",
          name: "CI",
          scopes: ["publish", "yank"],
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-31T00:00:00Z",
          lastUsedAt: null,
          token: "at-456",
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      [
        "token",
        "create",
        "--name",
        "CI",
        "--scope",
        "publish",
        "--scope",
        "yank",
        "--expires-in-days",
        "30",
        "--url",
        hub.url,
      ],
      {
        env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created token "CI" with scope publish, yank/);
    assert.match(result.stdout, /at-456/);
    const request = hub.requests.find((r) => r.path === "/tokens");
    assert.deepEqual(request.body, { name: "CI", scopes: ["publish", "yank"], expiresInDays: 30 });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("publish packs sources and leaves out build output, dependencies and dotfiles", async () => {
  const { dir, cleanup } = tmpHome();
  const project = mkdtempSync(join(tmpdir(), "twext-project-"));
  try {
    const init = await runCli(["init"], { cwd: project, env: { HOME: dir } });
    assert.equal(init.code, 0, init.stderr);
    mkdirSync(join(project, "dist"), { recursive: true });
    writeFileSync(join(project, "dist", "extension.js"), "// built");
    mkdirSync(join(project, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(project, "node_modules", "dep", "index.js"), "// dependency");
    writeFileSync(join(project, ".env"), "SECRET=1", "utf8");
    const hub = await createHub([
      {
        method: "POST",
        path: "/@user/myextension/versions",
        reply: {
          status: 201,
          body: {
            namespace: "user",
            id: "myextension",
            version: "0.1.0",
            status: "published",
            dist: { downloadUrl: "https://hub.test/myextension.js" },
          },
        },
      },
    ]);
    try {
      const publish = await runCli(["publish", "--url", hub.url], {
        cwd: project,
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "user", TWEXTHUB_TOKEN: "sess-1" },
      });
      assert.equal(publish.code, 0, publish.stderr);
      const request = hub.requests.find((r) => r.path === "/@user/myextension/versions");
      const entries = tarEntries(request.raw);
      const names = entries.map((entry) => entry.name);
      for (const name of ["twext.yml", "package.json", "src/index.js", "src/blocks/hello.js"]) {
        assert.ok(names.includes(name), `${name} should be packed`);
      }
      assert.ok(
        !names.some((name) => name.startsWith(".") || /(^|\/)(dist|node_modules)\//.test(name)),
        `dotfiles, build output and dependencies stay out of the tarball: ${names.join(", ")}`,
      );
      const pkg = entries.find((entry) => entry.name === "package.json");
      assert.equal(JSON.parse(pkg.data.toString("utf8")).type, "module");
    } finally {
      await hub.close();
    }
  } finally {
    cleanup();
    rmSync(project, { recursive: true, force: true });
  }
});

test("publish reports the build log when the hub's build fails", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 422,
        body: {
          title: "Build Failed",
          detail: 'No handler for opcode "missing"',
          buildLog: "twext build output",
          buildError: 'No handler for opcode "missing"',
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      { env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No handler for opcode/);
    assert.match(result.stdout, /twext build output/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("publish uploads to the versions path without a visibility query", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 201,
        body: {
          namespace: "acme",
          id: "superutilities",
          version: "1.0.0",
          status: "published",
        },
      },
    },
  ]);
  try {
    const publish = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      { env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" } },
    );
    assert.equal(publish.code, 0, publish.stderr);
    assert.match(publish.stdout, /Publishing superutilities@1\.0\.0 to @acme/);
    const request = hub.requests.find((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(request.query, "");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("checkout unpacks published sources, latest or resolved from a range on a later page", async () => {
  const { dir, cleanup } = tmpHome();
  const parent = mkdtempSync(join(tmpdir(), "twext-checkout-"));
  const source = await createProjectTarball(
    fixture("basic"),
    join(fixture("basic"), "twext.yml"),
    join(fixture("basic"), "dist", "extension.js"),
  );
  const version = (v) => ({
    namespace: "acme",
    id: "superutilities",
    version: v,
    status: "published",
  });
  const hub = await createHub([
    {
      method: "GET",
      path: "/@acme/superutilities/versions/latest",
      reply: { status: 200, body: version("1.0.0") },
    },
    {
      method: "GET",
      path: "/@acme/superutilities/versions",
      reply: (request) => {
        const next = new URLSearchParams(request.query).has("page");
        return {
          status: 200,
          body: {
            data: next ? [version("1.0.0")] : [],
            _links: { next: next ? null : `?${request.query}&page=2` },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/@acme/superutilities/versions/1.0.0",
      reply: { status: 200, body: version("1.0.0") },
    },
    {
      method: "GET",
      path: "/@acme/superutilities/versions/1.0.0/source",
      reply: { status: 200, contentType: "application/gzip", body: source },
    },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_NAMESPACE: "fallback", TWEXTHUB_TOKEN: "sess-1" };
    const latest = await runCli(
      ["checkout", "superutilities", "--namespace", "acme", "--url", hub.url],
      {
        cwd: parent,
        env,
      },
    );
    assert.equal(latest.code, 0, latest.stderr);
    assert.match(latest.stdout, /Checked out @acme\/superutilities@1\.0\.0 into superutilities/);
    assert.ok(existsSync(join(parent, "superutilities", "twext.yml")));
    assert.ok(existsSync(join(parent, "superutilities", "src", "index.js")));
    const meta = hub.requests.find((r) => r.path === "/@acme/superutilities/versions/latest");
    assert.equal(meta.authorization, "Bearer sess-1");

    const ranged = await runCli(
      ["checkout", "superutilities@^1.0", "from-range", "--namespace", "acme", "--url", hub.url],
      { cwd: parent, env },
    );
    assert.equal(ranged.code, 0, ranged.stderr);
    assert.match(ranged.stdout, /Checked out @acme\/superutilities@1\.0\.0 into from-range/);
    const list = hub.requests.find((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(list.query, "limit=50&range=%5E1.0");
    const pages = hub.requests.filter((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(pages.length, 2);
    assert.equal(pages[1].query, "limit=50&range=%5E1.0&page=2");
    const sources = hub.requests.filter((r) => r.path.endsWith("/source"));
    assert.equal(sources.length, 2);
    assert.equal(sources[0].authorization, "Bearer sess-1");

    const again = await runCli(
      ["checkout", "superutilities", "--namespace", "acme", "--url", hub.url],
      {
        cwd: parent,
        env,
      },
    );
    assert.equal(again.code, 1);
    assert.match(again.stderr, /exists and is not empty/);
  } finally {
    cleanup();
    rmSync(parent, { recursive: true, force: true });
    await hub.close();
  }
});

test("checkout reports a source tarball the caller does not own", async () => {
  const { dir, cleanup } = tmpHome();
  const parent = mkdtempSync(join(tmpdir(), "twext-checkout-"));
  const version = { namespace: "someone", id: "theirthing", version: "1.0.0", status: "published" };
  const hub = await createHub([
    {
      method: "GET",
      path: "/@someone/theirthing/versions/latest",
      reply: { status: 200, body: version },
    },
    {
      method: "GET",
      path: "/@someone/theirthing/versions/1.0.0/source",
      reply: {
        status: 404,
        body: {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Only an owner or an admin can fetch the source.",
        },
      },
    },
  ]);
  try {
    const checkout = await runCli(["checkout", "@someone/theirthing", "--url", hub.url], {
      cwd: parent,
      env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(checkout.code, 1);
    assert.match(checkout.stderr, /Only an owner or an admin can fetch the source/);
    assert.ok(!existsSync(join(parent, "theirthing")), "no directory is left behind");
  } finally {
    cleanup();
    rmSync(parent, { recursive: true, force: true });
    await hub.close();
  }
});

test("notifications lists the mailbox and marks rows read with --read", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: {
          data: [
            {
              id: "12",
              kind: "review.rejected",
              message: "superutilities@1.0.0 was rejected",
              payload: { reason: "bad" },
              read: false,
              createdAt: "2026-09-27T00:00:00Z",
            },
            {
              id: "13",
              kind: "broadcast",
              message: "Maintenance tonight",
              payload: {},
              read: true,
              createdAt: "2026-09-26T00:00:00Z",
            },
          ],
          unreadCount: 1,
          _links: { self: "x", next: null, prev: null },
        },
      },
    },
    { method: "PATCH", path: "/notifications", reply: { status: 200, body: { updated: 1 } } },
  ]);
  try {
    const result = await runCli(
      ["notifications", "--read", "--token", "selected-token", "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /2 notifications, 1 unread/);
    assert.match(result.stdout, /review\.rejected \(unread\): superutilities@1\.0\.0 was rejected/);
    assert.match(result.stdout, /broadcast: Maintenance tonight/);
    assert.match(result.stdout, /Marked 1 as read/);
    const patch = hub.requests.find((r) => r.method === "PATCH");
    assert.equal(patch.authorization, "Bearer selected-token");
    assert.ok(hub.requests.every((r) => r.authorization === "Bearer selected-token"));
    assert.deepEqual(patch.body, { ids: [12] });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("tag sets, lists and removes dist-tags", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    { method: "PUT", path: "/@acme/superutilities/tags/next", reply: { status: 204 } },
    {
      method: "GET",
      path: "/@acme/superutilities/tags",
      reply: { status: 200, body: { latest: "1.0.0", next: "1.2.0" } },
    },
    { method: "DELETE", path: "/@acme/superutilities/tags/next", reply: { status: 204 } },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_NAMESPACE: "fallback", TWEXTHUB_TOKEN: "sess-1" };
    const config = [
      "--config",
      fixture("basic/twext.yml"),
      "--namespace",
      "acme",
      "--url",
      hub.url,
    ];

    const set = await runCli(["tag", "set", "next", "1.2.0", ...config], { env });
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /Set next → superutilities@1\.2\.0/);
    assert.deepEqual(hub.requests.find((r) => r.method === "PUT").body, { version: "1.2.0" });

    const list = await runCli(["tag", "list", ...config], { env });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /2 tags on @acme\/superutilities/);
    assert.match(list.stdout, /next → 1\.2\.0/);
    assert.equal(
      hub.requests.find((r) => r.method === "GET").authorization,
      "Bearer sess-1",
      "listing tags carries the token so the hub resolves the caller's own extension",
    );

    const removed = await runCli(["tag", "rm", "next", ...config], { env });
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /Removed the next tag from superutilities/);

    const bad = await runCli(["tag", "set", "../evil", "1.0.0", ...config], { env });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Tag name "\.\.\/evil" is invalid/);
    assert.equal(
      hub.requests.filter((r) => r.method === "PUT").length,
      1,
      "an invalid tag name never reaches the hub",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("info prints extension detail, a single version and range matches", async () => {
  const { dir, cleanup } = tmpHome();
  const detail = {
    namespace: "acme",
    id: "superutilities",
    name: "Super Utilities",
    version: "1.0.0",
    description: "Custom utility blocks",
    publishedAt: "2026-09-27T00:00:00Z",
    license: "MIT",
    author: "Kane",
    versions: [
      {
        version: "1.0.0",
        status: "published",
        publishedAt: "2026-09-27T00:00:00Z",
        dist: { downloadUrl: "https://hub.test/x.js", digest: "sha256:abc" },
      },
      {
        version: "0.9.0",
        status: "deprecated",
        deprecation: "use 1.0.0",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ],
  };
  const hub = await createHub([
    { method: "GET", path: "/@acme/superutilities", reply: { status: 200, body: detail } },
    {
      method: "GET",
      path: "/@acme/superutilities/versions/1.0.0",
      reply: {
        status: 200,
        body: {
          namespace: "acme",
          id: "superutilities",
          name: "Super Utilities",
          version: "1.0.0",
          status: "published",
          createdAt: "2026-09-27T00:00:00Z",
          dist: { downloadUrl: "https://hub.test/x.js", digest: "sha256:abc" },
        },
      },
    },
    {
      method: "GET",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 200,
        body: {
          data: [
            { version: "1.2.0", status: "published", publishedAt: "2026-10-01T00:00:00Z" },
            { version: "1.1.0", status: "published", publishedAt: "2026-09-28T00:00:00Z" },
          ],
          _links: {},
        },
      },
    },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_NAMESPACE: "fallback", TWEXTHUB_TOKEN: "sess-1" };

    const full = await runCli(["info", "superutilities", "--namespace", "acme", "--url", hub.url], {
      env,
    });
    assert.equal(full.code, 0, full.stderr);
    assert.equal(
      hub.requests[0].authorization,
      "Bearer sess-1",
      "reads carry the token so the hub shows the caller its own unpublished versions",
    );
    assert.match(full.stdout, /Super Utilities @acme\/superutilities/);
    assert.match(full.stdout, /versions:/);
    assert.match(full.stdout, /1\.0\.0 published \(2026-09-27\)/);
    assert.match(full.stdout, /0\.9\.0 deprecated — use 1\.0\.0/);
    assert.match(full.stdout, /download https:\/\/hub\.test\/x\.js/);

    const one = await runCli(
      ["info", "superutilities@1.0.0", "--namespace", "acme", "--url", hub.url],
      { env },
    );
    assert.equal(one.code, 0, one.stderr);
    assert.match(one.stdout, /status published/);
    assert.match(one.stdout, /digest sha256:abc/);

    const ranged = await runCli(
      ["info", "superutilities@^1.2", "--namespace", "acme", "--url", hub.url],
      { env },
    );
    assert.equal(ranged.code, 0, ranged.stderr);
    assert.match(ranged.stdout, /2 versions of @acme\/superutilities match \^1\.2/);
    const list = hub.requests.find((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(list.query, "limit=50&range=%5E1.2");

    const bad = await runCli(["info", "../../admin", "--namespace", "acme", "--url", hub.url], {
      env,
    });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /is invalid/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/@acme/superutilities").length,
      1,
      "a bad spec never reaches the hub",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("search queries the registry and validates --sort", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/search",
      reply: {
        status: 200,
        body: {
          data: [
            {
              namespace: "acme",
              id: "superutilities",
              name: "Super Utilities",
              version: "1.0.0",
              description: "Custom utility blocks for TurboWarp performance",
              publishedAt: "2026-09-27T00:00:00Z",
            },
          ],
          _links: { self: "x", next: null, prev: null },
        },
      },
    },
  ]);
  try {
    const search = await runCli(
      ["search", "turbo", "blocks", "--sort", "downloads", "--url", hub.url],
      { env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" } },
    );
    assert.equal(search.code, 0, search.stderr);
    assert.match(search.stdout, /1 extension matching "turbo blocks"/);
    assert.match(search.stdout, /Super Utilities \(@acme\/superutilities@1\.0\.0\)/);
    const request = hub.requests.find((r) => r.path === "/search");
    assert.equal(request.query, "limit=50&query=turbo+blocks&sort=downloads");
    assert.equal(
      request.authorization,
      "Bearer sess-1",
      "search carries the token so the caller sees its own unpublished extensions",
    );

    const bad = await runCli(["search", "--sort", "bogus", "--url", hub.url], {
      env: { HOME: dir },
    });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--sort must be one of/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/search").length,
      1,
      "an invalid sort never reaches the hub",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("deprecate sets and clears a deprecation message", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "PATCH",
      path: "/@acme/superutilities/versions/1.0.0",
      reply: (request) => ({
        status: 200,
        body: {
          namespace: "acme",
          id: "superutilities",
          version: "1.0.0",
          status: request.body.deprecationMessage ? "deprecated" : "published",
          deprecation: request.body.deprecationMessage,
          createdAt: "2026-09-27T00:00:00Z",
        },
      }),
    },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_NAMESPACE: "fallback", TWEXTHUB_TOKEN: "sess-1" };
    const config = [
      "--config",
      fixture("basic/twext.yml"),
      "--namespace",
      "acme",
      "--url",
      hub.url,
    ];

    const set = await runCli(["deprecate", "1.0.0", "use", "1.1.0", ...config], { env });
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /Deprecated superutilities@1\.0\.0: use 1\.1\.0/);
    assert.deepEqual(hub.requests[0].body, { deprecationMessage: "use 1.1.0" });

    const clear = await runCli(["deprecate", "1.0.0", "--clear", ...config], { env });
    assert.equal(clear.code, 0, clear.stderr);
    assert.match(clear.stdout, /Cleared the deprecation on superutilities@1\.0\.0/);
    assert.deepEqual(hub.requests[1].body, { deprecationMessage: null });

    const usage = await runCli(["deprecate", "1.0.0", ...config], { env });
    assert.equal(usage.code, 1);
    assert.match(usage.stderr, /Usage: twext deprecate/);

    const notAVersion = await runCli(["deprecate", "^1.2", "gone", ...config], { env });
    assert.equal(notAVersion.code, 1);
    assert.match(notAVersion.stderr, /is not a version/);
    assert.equal(hub.requests.length, 2, "usage errors never reach the hub");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("X-ranges and partial versions are ranges while exact versions and dist-tags are not", () => {
  for (const version of ["1", "1.2", "1.x", "1.2.x", "1.2.X", "1.x.x", "x", "*", "^1.2", "~1.2"]) {
    assert.equal(isRange(version), true, version);
  }
  for (const version of [
    "1.2.3",
    "1.2.3-beta.1",
    "1.2.3+build",
    "latest",
    "next",
    "experimental",
    "v2",
  ]) {
    assert.equal(isRange(version), false, version);
  }
});

test("info and search collect every page and retain credentials and query parameters", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    ...["/@acme/superutilities/versions", "/search"].map((path) => ({
      method: "GET",
      path: `/api/v1${path}`,
      reply: (request) => {
        const query = new URLSearchParams(request.query);
        const page = Number(query.get("page") ?? 1);
        query.set("page", String(page + 1));
        return {
          status: 200,
          body: {
            data: [
              {
                name: `Result ${page}`,
                namespace: "acme",
                id: "superutilities",
                version: `1.2.${4 - page}`,
                status: "published",
              },
            ],
            _links: {
              next:
                page === 3 ? null : page === 1 ? `${hub.url}${request.path}?${query}` : `?${query}`,
            },
          },
        };
      },
    })),
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_NAMESPACE: "fallback", TWEXTHUB_TOKEN: "selected-token" };
    for (const range of ["1.2.x", "1.2"]) {
      const info = await runCli(
        ["info", `superutilities@${range}`, "-n", "acme", "--url", `${hub.url}/api/v1`],
        { env },
      );
      assert.equal(info.code, 0, info.stderr);
      assert.match(info.stdout, /3 versions of @acme\/superutilities/);
      assert.match(info.stdout, /1\.2\.1 published/);
      assert.ok(
        hub.requests.slice(-3).every((r) => new URLSearchParams(r.query).get("range") === range),
      );
    }
    const search = await runCli(
      ["search", "blocks", "--sort", "downloads", "--url", `${hub.url}/api/v1`],
      { env },
    );
    assert.equal(search.code, 0, search.stderr);
    assert.match(search.stdout, /3 extensions matching "blocks"/);
    assert.match(search.stdout, /Result 3/);
    assert.equal(hub.requests.length, 9);
    assert.ok(hub.requests.every((r) => r.authorization === "Bearer selected-token"));
    assert.ok(
      hub.requests.slice(-3).every((r) => new URLSearchParams(r.query).get("sort") === "downloads"),
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("tag list fails on 404 and reports no tags only for a successful empty response", async () => {
  const { dir, cleanup } = tmpHome();
  let status = 404;
  const hub = await createHub([
    {
      method: "GET",
      path: "/@acme/superutilities/tags",
      reply: () => ({ status, body: status === 404 ? { detail: "Extension missing" } : {} }),
    },
  ]);
  try {
    const args = [
      "tag",
      "list",
      "--config",
      fixture("basic/twext.yml"),
      "--namespace",
      "acme",
      "--url",
      hub.url,
    ];
    const failed = await runCli(args, { env: { HOME: dir } });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /Extension missing/);
    assert.doesNotMatch(failed.stdout, /has no tags/);
    status = 200;
    const empty = await runCli(args, { env: { HOME: dir } });
    assert.equal(empty.code, 0, empty.stderr);
    assert.match(empty.stdout, /has no tags/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("non-JSON HTTP failures retain their status, including source downloads", async () => {
  let status = 502;
  const body = Buffer.from("<html>Bad Gateway</html>");
  const hub = await createHub(
    ["", "/source"].map((suffix) => ({
      method: "GET",
      path: `/@acme/example/versions/1.0.0${suffix}`,
      reply: () => ({ status, body }),
    })),
  );
  try {
    await assert.rejects(
      getVersion(hub.url, "acme", "example", "1.0.0"),
      (err) => err instanceof HubError && err.status === 502 && err.message === "HTTP 502",
    );
    await assert.rejects(
      downloadSource(hub.url, "token", "acme", "example", "1.0.0"),
      (err) => err instanceof HubError && err.status === 502,
    );
    status = 200;
    await assert.rejects(getVersion(hub.url, "acme", "example", "1.0.0"), SyntaxError);
    assert.deepEqual(await downloadSource(hub.url, "token", "acme", "example", "1.0.0"), body);
  } finally {
    await hub.close();
  }
});

test("publish rejects invalid stored namespaces before any hub request", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([]);
  try {
    mkdirSync(join(dir, ".twext"));
    for (const namespace of [123, true, ["acme"], "../admin", "UPPER", "-invalid"]) {
      writeFileSync(
        join(dir, ".twext/config.json"),
        JSON.stringify({ hub: hub.url, token: "session", namespace }),
      );
      const result = await runCli(["publish", "--config", fixture("basic/twext.yml")], {
        env: { HOME: dir },
      });
      assert.equal(result.code, 1, JSON.stringify(namespace));
      assert.match(result.stderr, /Namespace .* is invalid/);
    }
    assert.equal(hub.requests.length, 0);
  } finally {
    cleanup();
    await hub.close();
  }
});

function sourceArchive(entries) {
  const chunks = [];
  for (const [path, data] of entries) {
    const header = new Header({ path, size: data.length, type: "File", mode: 0o644 });
    header.encode();
    chunks.push(header.block, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test("checkout cleans failed extraction and completes all writes before succeeding on retry", async () => {
  const { dir, cleanup } = tmpHome();
  const contents = Buffer.alloc(1024 * 1024, "source\n");
  let source = sourceArchive([
    ["src/index.js", contents],
    ["../escape", Buffer.from("invalid")],
    ["later/file.js", contents],
  ]);
  const hub = await createHub([
    {
      method: "GET",
      path: "/@acme/example/versions",
      reply: { status: 200, body: { data: [{ version: "1.2.3" }] } },
    },
    {
      method: "GET",
      path: "/@acme/example/versions/1.2.3",
      reply: { status: 200, body: { version: "1.2.3" } },
    },
    {
      method: "GET",
      path: "/@acme/example/versions/1.2.3/source",
      reply: () => ({ status: 200, body: source }),
    },
  ]);
  const errors = [];
  const log = { error: (message) => errors.push(message), success: () => {} };
  const options = { url: hub.url, namespace: "acme", token: "selected-token" };
  try {
    for (const existing of [false, true]) {
      const destination = join(dir, existing ? "existing" : "new");
      if (existing) mkdirSync(destination);
      assert.equal(await checkoutCommand({}, "example@1.2.x", destination, options, log), false);
      assert.match(errors.at(-1), /contains '\.\.'/);
      assert.equal(existsSync(destination), existing);
      if (existing) assert.deepEqual(readdirSync(destination), []);
      assert.ok(readdirSync(dir).every((name) => !name.startsWith(".twext-checkout-")));
    }
    source = sourceArchive([
      ["src/index.js", contents],
      ["later/file.js", contents],
    ]);
    for (const destination of [join(dir, "new"), join(dir, "existing")]) {
      assert.equal(
        await checkoutCommand({}, "example@1.2", destination, options, log),
        true,
        errors.at(-1),
      );
      assert.deepEqual(readFileSync(join(destination, "src/index.js")), contents);
      assert.deepEqual(readFileSync(join(destination, "later/file.js")), contents);
    }
    assert.ok(readdirSync(dir).every((name) => !name.startsWith(".twext-checkout-")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("org create, update and delete act on the organization's own namespace", async () => {
  const { dir, cleanup } = tmpHome();
  let createAttempts = 0;
  const hub = await createHub([
    {
      method: "POST",
      path: "/orgs",
      reply: (request) => {
        if (request.authorization === "Bearer auto-tok") return termsProblem;
        if (createAttempts++ === 0) return termsProblem;
        return {
          status: 201,
          body: {
            namespace: request.body.namespace,
            displayName: "Acme",
            bio: "",
            createdAt: "2026-01-02T00:00:00Z",
          },
        };
      },
    },
    { method: "GET", path: "/terms", reply: { status: 200, body: { version: 4 } } },
    {
      method: "PATCH",
      path: "/users/kamixfox",
      reply: (request) => ({
        status: 200,
        body: { namespace: "kamixfox", termsAcceptedVersion: request.body.termsAcceptedVersion },
      }),
    },
    {
      method: "PATCH",
      path: "/orgs/acme",
      reply: (request) => ({ status: 200, body: { namespace: "acme", ...request.body } }),
    },
    { method: "DELETE", path: "/orgs/acme", reply: { status: 204 } },
  ]);
  try {
    mkdirSync(join(dir, ".twext"));
    writeFileSync(
      join(dir, ".twext/config.json"),
      JSON.stringify({ hub: hub.url, namespace: "kamixfox", token: "sess-1" }),
    );
    const created = await runCli(
      [
        "org",
        "create",
        "acme",
        "--display-name",
        "Acme",
        "--website",
        "https://acme.test",
        "--url",
        hub.url,
      ],
      { env: { HOME: dir, TWEXTHUB_NAMESPACE: "other-account" } },
    );
    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stdout, /Created organization @acme/);
    const posts = hub.requests.filter((r) => r.method === "POST" && r.path === "/orgs");
    assert.equal(posts.length, 2, "retried after the terms gate");
    const expected = {
      namespace: "acme",
      displayName: "Acme",
      website: "https://acme.test",
    };
    assert.deepEqual(posts[0].body, expected);
    assert.deepEqual(posts[1].body, expected);
    const acceptance = hub.requests.find(
      (r) => r.method === "PATCH" && r.path === "/users/kamixfox",
    );
    assert.equal(acceptance.authorization, "Bearer sess-1");
    assert.deepEqual(
      acceptance.body,
      { termsAcceptedVersion: 4 },
      "accepted on the account, not on the organization",
    );

    const updated = await runCli(
      ["org", "update", "acme", "--bio", "Blocks for TurboWarp", "--github", "", "--url", hub.url],
      { env: { HOME: dir } },
    );
    assert.equal(updated.code, 0, updated.stderr);
    assert.match(updated.stdout, /Updated @acme/);
    const patch = hub.requests.find((r) => r.method === "PATCH" && r.path === "/orgs/acme");
    assert.deepEqual(patch.body, { bio: "Blocks for TurboWarp", github: null });

    const nothing = await runCli(["org", "update", "acme", "--url", hub.url], {
      env: { HOME: dir },
    });
    assert.equal(nothing.code, 1);
    assert.match(nothing.stderr, /Nothing to change/);

    const unconfirmed = await runCli(["org", "delete", "acme", "--url", hub.url], {
      env: { HOME: dir },
    });
    assert.equal(unconfirmed.code, 1);
    assert.match(unconfirmed.stderr, /Pass --force to confirm/);
    assert.equal(
      hub.requests.filter((r) => r.method === "DELETE").length,
      0,
      "nothing is deleted without --force",
    );

    const deleted = await runCli(["org", "delete", "acme", "--force", "--url", hub.url], {
      env: { HOME: dir },
    });
    assert.equal(deleted.code, 0, deleted.stderr);
    assert.match(deleted.stdout, /Deleted @acme/);
    assert.equal(
      hub.requests.filter((r) => r.method === "DELETE")[0].authorization,
      "Bearer sess-1",
    );

    const withToken = await runCli(
      ["org", "create", "acme", "--token", "auto-tok", "--url", hub.url],
      { env: { HOME: dir } },
    );
    assert.equal(withToken.code, 1);
    assert.match(withToken.stderr, /Accept the terms with a session \(twext login\)/);

    const anonymous = await runCli(["org", "create", "acme", "--url", "https://hub.test"], {
      env: { HOME: join(dir, "empty") },
    });
    assert.equal(anonymous.code, 1);
    assert.match(anonymous.stderr, /No token/);

    const bad = await runCli(["org", "info", "../admin", "--url", hub.url], { env: { HOME: dir } });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Namespace "\.\.\/admin" is invalid/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/orgs/acme" && r.method === "GET").length,
      0,
      "an invalid namespace never reaches the hub",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("org list, info, owners and extensions are public reads", async () => {
  const { dir, cleanup } = tmpHome();
  const organization = {
    namespace: "acme",
    displayName: "Acme",
    bio: "Blocks for TurboWarp",
    website: "https://acme.test",
    github: "acme",
    createdAt: "2026-01-02T00:00:00Z",
  };
  const hub = await createHub([
    {
      method: "GET",
      path: "/orgs",
      reply: {
        status: 200,
        body: { data: [organization], _links: { self: "x", next: null, prev: null } },
      },
    },
    { method: "GET", path: "/orgs/acme", reply: { status: 200, body: organization } },
    {
      method: "GET",
      path: "/orgs/acme/owners",
      reply: {
        status: 200,
        body: {
          data: [
            { namespace: "kamixfox", displayName: "Kane", addedAt: "2026-01-02T00:00:00Z" },
            { namespace: "alice", displayName: "Alice", addedAt: "2026-03-04T00:00:00Z" },
          ],
        },
      },
    },
    {
      method: "GET",
      path: "/orgs/acme/extensions",
      reply: {
        status: 200,
        body: {
          data: [
            {
              namespace: "acme",
              id: "superutilities",
              name: "Super Utilities",
              version: "1.2.0",
            },
          ],
          _links: { self: "x", next: null, prev: null },
        },
      },
    },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_TOKEN: "sess-1" };

    const list = await runCli(["org", "list", "--url", hub.url], { env });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /1 organization/);
    assert.match(list.stdout, /Acme \(@acme\)/);

    const info = await runCli(["org", "info", "acme", "--url", hub.url], { env });
    assert.equal(info.code, 0, info.stderr);
    assert.match(info.stdout, /Acme \(@acme\)/);
    assert.match(info.stdout, /Blocks for TurboWarp/);
    assert.match(info.stdout, /github\.com\/acme/);
    assert.match(info.stdout, /created 2026-01-02/);

    const owners = await runCli(["org", "owners", "acme", "--url", hub.url], { env });
    assert.equal(owners.code, 0, owners.stderr);
    assert.match(owners.stdout, /2 owners of @acme/);
    assert.match(owners.stdout, /Kane \(@kamixfox\) since 2026-01-02/);

    const extensions = await runCli(
      ["org", "extensions", "acme", "--sort", "downloads", "--license", "MIT", "--url", hub.url],
      { env },
    );
    assert.equal(extensions.code, 0, extensions.stderr);
    assert.match(extensions.stdout, /1 extension in @acme/);
    assert.match(extensions.stdout, /Super Utilities \(@acme\/superutilities@1\.2\.0\)/);
    const listing = hub.requests.find((r) => r.path === "/orgs/acme/extensions");
    assert.equal(listing.query, "limit=50&sort=downloads&license=MIT");
    assert.equal(
      listing.authorization,
      "Bearer sess-1",
      "the listing carries the token so an owner sees their unpublished extensions",
    );

    for (const path of ["/orgs", "/orgs/acme", "/orgs/acme/owners"]) {
      assert.equal(
        hub.requests.find((r) => r.path === path).authorization,
        null,
        `${path} carries no credentials`,
      );
    }

    const bad = await runCli(["org", "extensions", "acme", "--sort", "bogus", "--url", hub.url], {
      env,
    });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--sort must be one of/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("org add and remove work on the owner list, and the hub's refusals reach the terminal", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    { method: "PUT", path: "/orgs/acme/owners/alice", reply: { status: 204 } },
    {
      method: "DELETE",
      path: "/orgs/acme/owners/kamixfox",
      reply: { status: 409, body: { detail: "That is the only owner." } },
    },
  ]);
  try {
    const env = { HOME: dir, TWEXTHUB_TOKEN: "sess-1" };

    const added = await runCli(["org", "add", "acme", "alice", "--url", hub.url], { env });
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /Added @alice as an owner of @acme/);
    const grant = hub.requests.find((r) => r.method === "PUT");
    assert.equal(grant.authorization, "Bearer sess-1");

    const refused = await runCli(["org", "remove", "acme", "kamixfox", "--url", hub.url], {
      env,
    });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /That is the only owner/);

    const missing = await runCli(["org", "add", "acme", "--url", hub.url], { env });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Usage: twext org add/);
    assert.equal(
      hub.requests.filter((r) => r.method === "PUT").length,
      1,
      "a missing account never reaches the hub",
    );

    const unknown = await runCli(["org", "frobnicate", "--url", hub.url], { env });
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /Unknown org subcommand "frobnicate"/);
  } finally {
    cleanup();
    await hub.close();
  }
});
