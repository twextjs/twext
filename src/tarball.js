import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { create as createTar } from "tar";

function pack(cwd, files) {
  return new Promise((finish, fail) => {
    const stream = createTar({ gzip: true, portable: true, cwd }, files);
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => finish(Buffer.concat(chunks)));
    stream.on("error", fail);
  });
}

// The hub unpacks this archive and runs `twext build` in it, so it carries the
// project file, the sources and a package.json marked as ESM, and leaves out
// dotfiles, dependencies and whatever the last build wrote.
export async function createProjectTarball(root, configPath, output) {
  const outputDir = dirname(output);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (path === outputDir || path === output) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path));
    }
  };
  walk(root);
  files.sort();

  const staging = mkdtempSync(join(tmpdir(), "twext-publish-"));
  try {
    for (const rel of files) {
      const dest = join(staging, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(root, rel)));
    }
    writeFileSync(join(staging, "twext.yml"), readFileSync(configPath));
    const pkgPath = join(staging, "package.json");
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : {};
    writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, type: "module" }, null, 2)}\n`);

    const entries = new Set(files);
    entries.add("twext.yml");
    entries.add("package.json");
    return await pack(staging, [...entries].sort());
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
