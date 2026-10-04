import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectConfig, resolveOutputPath } from "../project.js";
import { buildProduct } from "./build.js";
import { startDevServer } from "../dev-server.js";

const workerPath = fileURLToPath(new URL("../dev-build.js", import.meta.url));
const SERVED_PATH = "/extension.js";
const DEBOUNCE_MS = 50;

// A build reads twext.yml and the module graph the entry point imports, so
// nothing else in the project is worth a rebuild. Without this, a log file
// written into the project rebuilds on every line it writes.
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".yml", ".yaml"]);

// Node caches imported modules for the life of the process, and the entry point
// pulls in every handler through static imports that a cache-busting query
// string can't reach. A child process is the only way to get a build that
// actually sees the file on disk.
function buildInChildProcess(configPath, output) {
  return new Promise((finish) => {
    const child = spawn(process.execPath, [workerPath, configPath, output], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", () => {});
    child.on("error", (err) => finish({ ok: false, stderr: err.message }));
    child.on("close", (code) => finish({ ok: code === 0, stderr }));
  });
}

// fs.watch's recursive mode watches every directory in the tree, which means
// node_modules and whatever the editor leaves behind. Walking it by hand keeps
// the watch list down to the sources.
function watchTree(root, skipDirectory, skipFile, onChange) {
  const watchers = new Map();
  const add = (dir) => {
    if (skipDirectory(dir) || watchers.has(dir)) return;
    try {
      watchers.set(
        dir,
        watch(dir, (_event, filename) => {
          if (!filename) {
            onChange(dir);
            return;
          }
          const path = join(dir, filename);
          // A directory made after startup needs its own watcher, or a file
          // written into it later goes unnoticed.
          if (existsSync(path) && statSync(path).isDirectory()) {
            add(path);
            return;
          }
          if (!skipFile(path)) onChange(path);
        }),
      );
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) add(join(dir, entry.name));
      }
    } catch {
      watchers.get(dir)?.close();
      watchers.delete(dir);
    }
  };
  add(root);
  return () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}

export async function devCommand(product, configPath, { port, out }, log) {
  const root = dirname(resolve(configPath));
  let config;
  try {
    config = readProjectConfig(configPath);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const listenPort = port === undefined ? product.defaults.devPort : Number(port);
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    log.error(`"${port}" is not a port number`);
    return false;
  }

  let source = null;
  let title = product.name;
  let output;
  let outputRel = "";
  let outputDirRel = "";
  const readSettings = (latest) => {
    output = resolveOutputPath(product, latest, root, out);
    outputRel = relative(root, output);
    outputDirRel = relative(root, dirname(output));
    title = latest.extension?.name ?? latest.name ?? product.name;
  };
  readSettings(config);

  const hidden = (rel) =>
    rel.split(sep).some((part) => part.startsWith(".") || part === "node_modules");
  const inside = (rel, base) => base !== "" && (rel === base || rel.startsWith(`${base}${sep}`));
  const skipDirectory = (dir) => {
    const rel = relative(root, dir);
    return rel !== "" && !rel.startsWith("..") && (inside(rel, outputDirRel) || hidden(rel));
  };
  const skipFile = (path) => {
    const rel = relative(root, path);
    if (rel === "" || rel.startsWith("..")) return true;
    if (rel === outputRel || inside(rel, outputDirRel)) return true;
    return hidden(rel) || !SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
  };

  // The first build runs here: the parent already paid to load the compiler and
  // YAML parser, and nothing from the project is in this process's module cache
  // yet, so a child would only add a second cold Node start before the server
  // can answer its first request.
  const compileInProcess = async () => {
    const result = await buildProduct(product, configPath, out);
    if (!result.ok) {
      for (const message of result.errors) log.error(message);
      return false;
    }
    for (const message of result.warnings) log.warn(message);
    readSettings(result.config);
    source = readFileSync(result.output, "utf8");
    log.success(`Built ${relative(process.cwd(), result.output) || result.output}`);
    return true;
  };

  // Every later build is a child: Node caches imported modules for the life of
  // the process, and the entry point's static imports can't be cache-busted.
  const compile = async () => {
    try {
      // twext.yml can move the output or rename the extension between builds.
      readSettings(readProjectConfig(configPath));
    } catch (err) {
      log.error(err.message);
      return false;
    }
    const result = await buildInChildProcess(configPath, output);
    if (!result.ok) {
      log.error("Build failed");
      if (result.stderr.trim()) log.raw(result.stderr.trimEnd());
      return false;
    }
    source = readFileSync(output, "utf8");
    log.success(`Built ${relative(process.cwd(), output) || output}`);
    return true;
  };

  const built = await compileInProcess();

  let server;
  try {
    server = await startDevServer({
      host: "127.0.0.1",
      port: listenPort,
      extensionPath: SERVED_PATH,
      getSource: () => source,
      getTitle: () => title,
    });
  } catch (err) {
    log.error(
      err.code === "EADDRINUSE"
        ? `Port ${listenPort} is in use. Pass --port to serve somewhere else.`
        : err.message,
    );
    return false;
  }

  log.success(`Serving ${server.extensionUrl}`);
  if (!built) log.warn("Nothing to serve yet; fix the error and it will pick the change up.");
  log.progress(`Watching ${root}. Press Ctrl+C to stop.`);

  let timer = null;
  let pending = null;
  let building = false;
  let queued = false;

  // One build at a time: a save that lands during a build queues exactly one
  // more, so a burst of editor writes can't pile up child processes.
  async function rebuild() {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    const changed = pending;
    pending = null;
    try {
      if (changed) log.progress(`${changed} changed`);
      await compile();
    } finally {
      building = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  }

  const stopWatching = watchTree(root, skipDirectory, skipFile, (path) => {
    pending ??= relative(process.cwd(), path);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void rebuild();
    }, DEBOUNCE_MS);
  });

  await new Promise((stopped) => {
    process.once("SIGINT", stopped);
    process.once("SIGTERM", stopped);
  });
  if (timer) clearTimeout(timer);
  stopWatching();
  await server.close();
  return true;
}
