# 🖥️ CLI Reference

```bash
twext <command> [options]
```

`build` is the default command, so `twext` on its own is the same as `twext build`. Every command exits 0 on success and 1 on failure. `twext help` prints the same summary that's below.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [🏗️ Building](#-building)
  - [`twext init [directory]`](#twext-init-directory)
  - [`twext build`](#twext-build)
  - [`twext validate`](#twext-validate)
  - [`twext dev`](#twext-dev)
- [🛜 TwextHub](#-twexthub)
  - [Options](#options)
  - [Extension Specs](#extension-specs)
  - [Organizations](#organizations)
- [🔑 Credentials and Hub URLs](#-credentials-and-hub-urls)
- [🔄 Publishing](#-publishing)
- [🧰 Other Options](#-other-options)
- [⌨️ Examples](#-examples)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 🏗️ Building

### `twext init [directory]`

Writes a working project: `twext.yml`, `src/index.js`, and `src/blocks/hello.js`. The directory defaults to the current one and is created if it doesn't exist.

| Option          | What it does                        |
| --------------- | ----------------------------------- |
| `-f`, `--force` | Overwrite files that already exist. |

`init` refuses to write through a symlink or outside the target directory, and it stops rather than writing `src/index.js` when `src` is already a file.

### `twext build`

Validates the project, compiles it, and writes the result.

| Option                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `-c`, `--config <file>` | Manifest to read. Defaults to `twext.yml`.                      |
| `-o`, `--out <file>`    | Where to write the compiled extension, overriding `outputPath`. |

Validation errors stop the build before anything is written. Warnings are printed and the build continues.

### `twext validate`

Runs the same checks as `build` and writes nothing. See [Validation](./validation.md).

| Option                  | What it does                               |
| ----------------------- | ------------------------------------------ |
| `-c`, `--config <file>` | Manifest to read. Defaults to `twext.yml`. |

### `twext dev`

Builds the project, then watches the sources and rebuilds whenever a `.js`, `.mjs`, `.cjs`, `.json`, `.yml`, or `.yaml` file changes. The compiled extension is served at `http://localhost:8090/extension.js`, so you can add a URL to TurboWarp instead of a file and reload to pick up each save. `Ctrl+C` stops the server.

| Option                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `-c`, `--config <file>` | Manifest to read. Defaults to `twext.yml`.                      |
| `-o`, `--out <file>`    | Where to write the compiled extension, overriding `outputPath`. |
| `-p`, `--port <number>` | Port to serve on. Defaults to `8090`; `0` picks a free one.     |

The server sends `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`, so TurboWarp won't hold onto a stale copy. A build that fails keeps the last good extension being served and prints the error; the next build that succeeds replaces it.

Only the sources the entry point can reach matter, so logs and editor scratch files don't cause rebuilds. The output directory is left alone, so a build can't loop on its own output.

## 🛜 TwextHub

These commands talk to a TwextHub. [Using TwextHub](./twexthub.md) walks through the workflows; this is the surface.

| Command                                     | What it does                                                          |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `twext signup`                              | Create an account.                                                    |
| `twext login`                               | Sign in and store the session.                                        |
| `twext logout`                              | Revoke the stored session at the hub and forget the credentials.      |
| `twext publish`                             | Validate, build, and upload the project sources.                      |
| `twext yank <version>`                      | Delete a published version.                                           |
| `twext deprecate <version> <message>`       | Attach a deprecation message to a version, or drop it with `--clear`. |
| `twext tag set <name> <version>`            | Point a dist-tag at a version.                                        |
| `twext tag rm <name>`                       | Remove a dist-tag.                                                    |
| `twext tag list`                            | List the dist-tags on the extension.                                  |
| `twext search [terms]`                      | Search the registry.                                                  |
| `twext info <id>[@version]`                 | Show registry details for an extension or a version.                  |
| `twext checkout <id>[@version] [directory]` | Download a published version's sources into a directory.              |
| `twext notifications`                       | List account notifications.                                           |
| `twext token create`                        | Create an automation token for CI.                                    |
| `twext org create <namespace>`              | Create an organization; you become its first owner.                   |
| `twext org list`                            | List the organizations on the hub.                                    |
| `twext org info <namespace>`                | Show an organization's profile.                                       |
| `twext org update <namespace>`              | Change the profile fields.                                            |
| `twext org delete <namespace> --force`      | Delete the organization and everything published under it.            |
| `twext org owners <namespace>`              | List an organization's owners.                                        |
| `twext org add <namespace> <account>`       | Add an owner.                                                         |
| `twext org remove <namespace> <account>`    | Remove an owner.                                                      |
| `twext org extensions <namespace>`          | List the extensions published under the namespace.                    |

### Options

| Option                     | Used by                                                   | What it does                                                                   |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `-u`, `--url <base>`       | all hub commands                                          | Hub API base URL.                                                              |
| `-n`, `--namespace <name>` | `login`, `signup`, `checkout`, `deprecate`, `tag`, `info` | Account namespace to act as.                                                   |
| `--password <password>`    | `login`, `signup`                                         | Password. Prompts when omitted.                                                |
| `--display-name <name>`    | `signup`, `org create`, `org update`                      | Display name for the new account or organization.                              |
| `--token <token>`          | all authenticated hub commands                            | Bearer token, instead of the stored one.                                       |
| `--read`                   | `notifications`                                           | Mark the listed notifications as read.                                         |
| `--sort <key>`             | `search`, `org extensions`                                | `recent`, `downloads`, `updated`, or `name`.                                   |
| `--clear`                  | `deprecate`                                               | Remove the deprecation message instead of setting one.                         |
| `--bio <text>`             | `org create`, `org update`                                | Organization bio. An empty value clears it.                                    |
| `--website <url>`          | `org create`, `org update`                                | Organization website. An empty value clears it.                                |
| `--github <user>`          | `org create`, `org update`                                | GitHub username shown on the profile. An empty value clears it.                |
| `--license <id>`           | `org extensions`                                          | Only extensions under this SPDX license, e.g. `MIT`.                           |
| `-f`, `--force`            | `init`, `org delete`                                      | Overwrite existing files; required by `org delete`.                            |
| `--name <name>`            | `token create`                                            | Name for the token. Defaults to `CI`.                                          |
| `--scope <scope>`          | `token create`                                            | `publish` and/or `yank`, repeatable or comma-separated. Defaults to `publish`. |
| `--expires-in-days <days>` | `token create`                                            | Lifetime of the token.                                                         |

`login` and `signup` prompt for anything you leave out, and `login` reads the stored namespace when you don't pass `-n`.

`publish`, `yank`, `deprecate`, and the `tag` subcommands all need a token. `checkout` needs one too, even for a public extension. `search` and `info` don't, though they send the stored token when there is one so the hub can show you your own extension. Of the `org` subcommands, `create`, `update`, `delete`, `add` and `remove` need a token; `list`, `info` and `owners` don't, and `extensions` sends the token for the same reason as `search` and `info`.

### Extension Specs

`checkout` and `info` take a spec that names the extension, and optionally a version:

```text
myext             the extension, latest version
myext@1.2.0       an exact version
myext@^1.2        the highest version matching a range
myext@latest      a dist-tag
@someone/myext    another namespace
@someone/myext@2  a namespace and a version
```

A namespace is 1 to 40 lower-case letters, digits, and hyphens, and can't start or end with a hyphen. When the spec doesn't name one, Twext uses your stored namespace, and `-n` overrides that.

A version with range syntax in it — `^`, `~`, `*`, `<`, `>`, `=`, a space, a partial like `1.x`, or a bare `1.2` — is a range, not an exact version. Twext asks the hub for the versions that match and takes the highest one, which is why `myext@1.2` gives you `1.2.9` and not `1.2.0`. Write all three parts when you mean one specific release.

`yank`, `deprecate`, and `tag` act on the extension in the current directory instead. They read `extension.id` from `twext.yml` and refuse to run when it's missing.

### Organizations

An organization is a namespace with an owner list instead of a password. It can't sign in; the accounts on its owner list act for it, and each of them has the same rights over it. [Using TwextHub](./twexthub.md#-organizations) walks through the workflow.

```text
twext org create <namespace> [--display-name NAME] [--bio TEXT] [--website URL] [--github USER]
twext org list
twext org info <namespace>
twext org update <namespace> [profile flags]
twext org delete <namespace> --force
twext org owners <namespace>
twext org add <namespace> <account>
twext org remove <namespace> <account>
twext org extensions <namespace> [--sort KEY] [--license SPDX]
```

Only the profile flags a subcommand was given are sent, so `org update` leaves the rest alone, and a flag passed as an empty value clears that field. `org delete` cascades to every extension, version, image and webhook under the namespace, which is why it needs `--force`.

Publishing under the organization is publishing under another namespace, so nothing about `publish` changes:

```bash
twext publish --namespace acme
```

## 🔑 Credentials and Hub URLs

`twext login` and `twext signup` write the hub URL, your namespace, and a session token to `~/.twext/config.json` with mode `0600`. Each setting is resolved from a flag first, then the environment, then the stored value:

| Setting   | Flag                | Environment variable | Default                          |
| --------- | ------------------- | -------------------- | -------------------------------- |
| Hub URL   | `-u`, `--url`       | `TWEXTHUB_URL`       | `https://twexts.sdisk.us/api/v1` |
| Token     | `--token`           | `TWEXTHUB_TOKEN`     | the stored session               |
| Namespace | `-n`, `--namespace` | `TWEXTHUB_NAMESPACE` | the stored namespace             |

Stored credentials only apply to the hub they were created against. Pointing `-u` at a different hub ignores the stored token and namespace, and `twext logout` only revokes at the stored one.

The hub has to be served over HTTPS. `http://` is accepted for `localhost`, `127.0.0.1`, and `::1`, so you can run one locally; anywhere else is refused before credentials leave the machine.

Requests give up after 30 seconds.

## 🔄 Publishing

`twext publish` does a full run on its own before it uploads anything:

1. Validate the project.
2. Compile it locally. The hub compiles what it receives, so this build exists to fail here rather than there.
3. Pack the project into a gzipped tarball. Dotfiles, `node_modules`, and the build output are left out; `twext.yml` goes in, and the archive's `package.json` is marked as ESM.
4. Upload it to `@<namespace>/<extension.id>` at the version from `twext.yml`.

If the hub's own build fails, the build log comes back with the error. If the account hasn't accepted the hub's current Terms of Service, `publish` accepts them for you and retries — but only when it's using your stored session, never when a token came from `--token` or `TWEXTHUB_TOKEN`. Run `twext publish` once while logged in so the terms are accepted on the account, then wire a token into CI.

A version that needs review comes back as `submitted for review (status: pending)` and appears in the registry once an admin approves it.

## 🧰 Other Options

| Option            | What it does         |
| ----------------- | -------------------- |
| `-h`, `--help`    | Print the help text. |
| `-v`, `--version` | Print the version.   |

## ⌨️ Examples

```bash
# Build a project in a different directory
twext build -c projects/greeter/twext.yml -o build/greeter.js

# Check a project without writing anything
twext validate

# Look at someone else's extension, then download it
twext info @someone/greeter
twext info @someone/greeter@^2.0
twext checkout @someone/greeter@^2.0 ./greeter

# Find extensions by name
twext search utility --sort downloads

# Move the latest tag and flag an old version
twext tag set latest 1.4.0
twext deprecate 1.0.0 "Use 1.4.0 instead"

# Create a CI token and publish with it
twext token create --name ci --scope publish --scope yank
TWEXTHUB_TOKEN=twext_... twext publish
```
