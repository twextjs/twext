# 🧑‍💻 Development Guide

Twext is developed like pretty much every other CLI out there. If you make changes, make sure to:

1. Format the code:

   ```bash
   npm run format
   ```

2. Lint the code:

   ```bash
   npm run lint
   ```

3. Perform tests on the CLI:

   ```bash
   npm run test
   ```

`npm run check` runs `lint`, `format:check`, and `test` sequentially and is the one to run before you push. It checks formatting without rewriting files; `npm run format` rewrites files.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [📦 Getting Set Up](#-getting-set-up)
- [🗂️ Project Layout](#-project-layout)
- [🧪 Tests](#-tests)
- [🤖 CI and Releases](#-ci-and-releases)
- [📖 Working on the Docs](#-working-on-the-docs)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 📦 Getting Set Up

Node.js 24 or newer, and nothing else — the CLI ships as a plain ES module with a `twext` bin and no build step.

```bash
npm install
npm test
```

Run the CLI straight out of the repository while you work on it:

```bash
node src/cli.js validate -c path/to/project/twext.yml
```

## 🗂️ Project Layout

| Path                                           | What it does                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/cli.js`                                   | Argument parsing, the command table, and the help text.                                                            |
| `src/commands/`                                | One file per command. Each exports a function that returns whether it succeeded.                                   |
| `src/compile.js`                               | Turns a validated project into the extension file. Block type tables, the emitted `getInfo()`, and the class body. |
| `src/validate.js`                              | The checks behind `twext validate`, and the shared `extension.id` reader the registry commands use.                |
| `src/free-vars.js`                             | The `espree` and `eslint-scope` analysis that finds names a handler reads but won't have.                          |
| `src/function-source.js`                       | Re-prints a handler from `Function.prototype.toString()`. Adding a function shape starts here.                     |
| `src/hub.js`                                   | The TwextHub HTTP client, plus reading and writing `~/.twext/config.json`.                                         |
| `src/spec.js`                                  | Parses `id@version` specs and decides whether a version is a range.                                                |
| `src/project.js`                               | Reads `twext.yml` and imports the entry point.                                                                     |
| `src/dev-server.js`                            | The HTTP server behind `twext dev`: routes the extension and the index page, and sends the no-cache headers.       |
| `src/dev-build.js`                             | The worker `twext dev` spawns for each rebuild, loading only the compiler instead of the whole CLI.                |
| `src/tarball.js`                               | Packs a project for `twext publish`.                                                                               |
| `src/prompt.js`, `src/log.js`, `src/format.js` | Terminal prompts, the colored output, and the day a hub timestamp is printed as.                                   |
| `src/config.js`                                | Loads `product.yml`.                                                                                               |
| `schema/twext.json`                            | The JSON Schema editors point at for `twext.yml`.                                                                  |
| `types/extension.d.ts`                         | The types editors import for the entry point module.                                                               |
| `product.yml`                                  | The name, command, version, tagline, output symbols, and defaults. Everything user-visible that isn't in the code. |
| `test/`, `test-fixtures/`                      | The test suite and the projects it runs against.                                                                   |
| `docs/`                                        | The documentation in this directory.                                                                               |

`product.yml` deserves a note: `twext --version` prints its `version`, the help text prints its `name` and `tagline`, the log symbols and colors come from it, and `defaults` supplies the config filename, the output directory, the dev server port, and the fallback block color. A change to a default there changes Twext's behavior, so it needs a test.

## 🧪 Tests

The suite runs on Node's built-in test runner. `npm test` picks up everything in `test/`, and a single file runs the same way:

```bash
node --test test/compile.test.js
```

`test-fixtures/` holds the projects the tests run against. `basic/` is a valid extension with arguments, a label, and a `setup` that exports a constant the handlers use; `broken/` is one that fails validation on purpose, with a missing handler, an unknown `blockType`, and an unknown argument type. Add a fixture when a test needs a project on disk, rather than writing the same YAML into a temporary directory again.

`test/hub.test.js` stands up a local HTTP server and points the CLI at it with `-u`, which is why the hub client only accepts HTTPS or a loopback address. Anything that talks to a hub should be tested that way instead of against the real one.

## 🤖 CI and Releases

CI runs on every push and pull request to `main`, on Node.js 24, in three jobs: `lint`, `format`, and `test`. The `lint` and `format` jobs run in parallel; `test` waits for both. The `format` job runs `npm run format:check`.

Releases are cut by pushing a tag. The CD workflow matches `v*`, re-runs lint, format, and test, then publishes to npm with `--provenance --access public`. The `files` list in `package.json` decides what goes in the tarball: `src`, `schema`, `types`, and `product.yml`.

To cut a release, bump the version in two places, then tag:

1. `version` in `package.json` — this is the version npm installs.
2. `version` in `product.yml` — this is the version `twext --version` prints.

```bash
git tag v1.1.0
git push origin v1.1.0
```

Leaving one behind them out of step gives a CLI that reports a version it isn't.

## 📖 Working on the Docs

The documentation is the `docs/` directory, and `docs/index.md` is the index that links to all of it. Pages link to each other with relative paths, so a moved page means fixing its inbound links.

Every page's table of contents is generated:

```bash
npm run doctoc
```

It rewrites the block between the `START doctoc` and `END doctoc` comments. Don't hand-edit those entries; run the command and commit what it produces. The headings in these files carry emoji, and new pages should follow the same convention.
