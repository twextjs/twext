#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadProduct } from "./config.js";
import { createLogger } from "./log.js";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { buildCommand } from "./commands/build.js";
import { devCommand } from "./commands/dev.js";
import { loginCommand } from "./commands/login.js";
import { signupCommand } from "./commands/signup.js";
import { logoutCommand } from "./commands/logout.js";
import { publishCommand } from "./commands/publish.js";
import { checkoutCommand } from "./commands/checkout.js";
import { yankCommand } from "./commands/yank.js";
import { deprecateCommand } from "./commands/deprecate.js";
import { tagCommand } from "./commands/tag.js";
import { infoCommand } from "./commands/info.js";
import { searchCommand } from "./commands/search.js";
import { notificationsCommand } from "./commands/notifications.js";
import { tokenCommand } from "./commands/token.js";
import { orgCommand } from "./commands/org.js";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  config: { type: "string", short: "c" },
  out: { type: "string", short: "o" },
  force: { type: "boolean", short: "f" },
  url: { type: "string", short: "u" },
  namespace: { type: "string", short: "n" },
  password: { type: "string" },
  "display-name": { type: "string" },
  token: { type: "string" },
  name: { type: "string" },
  scope: { type: "string", multiple: true },
  "expires-in-days": { type: "string" },
  private: { type: "boolean" },
  read: { type: "boolean" },
  sort: { type: "string" },
  clear: { type: "boolean" },
  bio: { type: "string" },
  website: { type: "string" },
  github: { type: "string" },
  license: { type: "string" },
  port: { type: "string", short: "p" },
};

function helpText(product) {
  return `${product.name} ${product.version} — ${product.tagline}

Usage: ${product.command} <command> [options]

Commands:
  build         Validate and compile the extension (default)
  dev           Rebuild on change and serve the extension at http://localhost:8090
  validate      Check blocks against the entryPoint handlers
  init          Scaffold a new project in a directory
  login         Sign in to a TwextHub hub
  signup        Create a new account on a TwextHub hub
  logout        Revoke the stored session at the hub and forget the credentials
  publish       Validate, build, and publish to the hub
  checkout      Download a published extension's sources (twext checkout myext@1.2.0)
  yank          Remove a published version from the hub (e.g. twext yank 1.0.0)
  deprecate     Flag a version, or drop the flag with --clear
  tag           Manage dist-tags (twext tag set latest 1.2.0)
  info          Registry info for an extension (twext info myext@^1.2)
  search        Search published extensions (twext search turbo)
  notifications List hub notifications (--read marks them read)
  token         Create an automation token for CI (e.g. twext token create)
  org           Manage organizations (e.g. twext org create acme)
  help          Show this help

Options:
  -c, --config <file>      Path to ${product.defaults.configFilename} (default: ${product.defaults.configFilename})
  -o, --out <file>         Override the output path (build, dev)
  -p, --port <number>      Port for the dev server (default: 8090)
  -f, --force              Overwrite existing files (init only); confirms org delete
  -u, --url <base>         Hub API base URL (default: https://twexts.sdisk.us/api/v1)
  -n, --namespace <name>   Account namespace (login/signup; login default: stored)
  --password <password>    Account password (login/signup; prompts when omitted)
  --display-name <name>    Display name (signup; org create/update)
  --token <token>          Bearer token override (default: \\$TWEXTHUB_TOKEN, then stored)
  --name <name>            Token name (token create only)
  --scope <scope>          Token scope, repeatable (token create only; default: publish)
  --expires-in-days <days> Token lifetime (token create only)
  --private                Publish a private version (publish only)
  --read                   Mark the listed notifications as read (notifications only)
  --sort <key>             Order: recent, downloads, updated, name (search, org extensions)
  --clear                  Drop a deprecation message (deprecate only)
  --bio <text>             Organization bio, "" clears it (org create/update)
  --website <url>          Organization website, "" clears it (org create/update)
  --github <user>          GitHub username, "" clears it (org create/update)
  --license <id>           SPDX license to filter by (org extensions only)
  -h, --help               Show this help
  -v, --version            Print the version`;
}

async function main(args) {
  const product = loadProduct();
  const log = createLogger(product);
  const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true });

  if (values.version) {
    console.log(`${product.name} ${product.version}`);
    return 0;
  }
  if (values.help) {
    console.log(helpText(product));
    return 0;
  }

  const command = positionals[0] ?? "build";
  const configPath = resolve(values.config ?? product.defaults.configFilename);
  switch (command) {
    case "help":
      console.log(helpText(product));
      return 0;
    case "init":
      return initCommand(product, positionals[1], values.force, log) ? 0 : 1;
    case "validate":
      return (await validateCommand(product, configPath, log)) ? 0 : 1;
    case "build":
      return (await buildCommand(product, configPath, values.out ? resolve(values.out) : null, log))
        ? 0
        : 1;
    case "dev":
      return (await devCommand(product, configPath, values, log)) ? 0 : 1;
    case "login":
      return (await loginCommand(product, values, log)) ? 0 : 1;
    case "signup":
      return (await signupCommand(product, values, log)) ? 0 : 1;
    case "logout":
      return (await logoutCommand(product, log)) ? 0 : 1;
    case "publish":
      return (await publishCommand(product, configPath, values, log)) ? 0 : 1;
    case "checkout":
      return (await checkoutCommand(product, positionals[1], positionals[2], values, log)) ? 0 : 1;
    case "yank":
      return (await yankCommand(product, positionals[1], configPath, values, log)) ? 0 : 1;
    case "deprecate":
      return (await deprecateCommand(
        product,
        positionals[1],
        positionals.slice(2),
        configPath,
        values,
        log,
      ))
        ? 0
        : 1;
    case "tag":
      return (await tagCommand(
        product,
        positionals[1],
        positionals.slice(2),
        configPath,
        values,
        log,
      ))
        ? 0
        : 1;
    case "info":
      return (await infoCommand(product, positionals[1], values, log)) ? 0 : 1;
    case "search":
      return (await searchCommand(product, positionals.slice(1), values, log)) ? 0 : 1;
    case "notifications":
      return (await notificationsCommand(product, values, log)) ? 0 : 1;
    case "token":
      return (await tokenCommand(product, positionals[1], values, log)) ? 0 : 1;
    case "org":
      return (await orgCommand(product, positionals[1], positionals.slice(2), values, log)) ? 0 : 1;
    default:
      log.error(`Unknown command "${command}"`);
      console.log(helpText(product));
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    const log = createLogger(loadProduct());
    log.error(err.message ?? String(err));
    process.exitCode = 1;
  });
