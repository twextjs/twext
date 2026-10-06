# 🛜 Using TwextHub

TwextHub is the official registry of extensions built with Twext. It's similar to the TurboWarp Extensions Gallery where it's built for TurboWarp, but it's different because anybody can upload their own extensions (or forks of others' extensions).

If you run `twext help`, you'll notice that most of the commands interact with TwextHub in some way. Some of the most notable commands are:

- `twext signup`: Register for a TwextHub account.
- `twext login`: Log in to your TwextHub account on a different device.
- `twext publish`: Publish an existing extension to TwextHub.
- `twext notifications`: Check your TwextHub account's notifications.

This file will explain how to use TwextHub with the Twext CLI. If you're looking for TwextHub's _web UI_, you can [click here to go to it.](https://twexts.sdisk.us)

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [👤 Getting an Account](#-getting-an-account)
  - [Where the Credentials Live](#where-the-credentials-live)
- [➕ Publishing](#-publishing)
- [🔔 Checking Your Notifications](#-checking-your-notifications)
- [🔍 Finding Extensions](#-finding-extensions)
- [📥 Checking Out Sources](#-checking-out-sources)
- [🏷️ Managing Versions](#-managing-versions)
  - [Moving a Dist-Tag](#moving-a-dist-tag)
  - [Deprecating a Version](#deprecating-a-version)
  - [Yanking a Version](#yanking-a-version)
- [🤖 Publishing From CI](#-publishing-from-ci)
- [👥 Organizations](#-organizations)
  - [Who Runs It](#who-runs-it)
  - [Editing the Profile](#editing-the-profile)
  - [Deleting One](#deleting-one)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 👤 Getting an Account

`twext signup` creates the account and signs you in with it. It asks for a namespace, which is the part of the extension name that comes before the slash, and a password:

```bash
twext signup
```

A namespace is 1 to 40 lower-case letters, digits, and hyphens, and can't start or end with a hyphen. It has to be unique on the hub, so pick something you'd want to keep.

To add a display name, or to script the account creation, pass the flags instead of answering the prompts:

```bash
twext signup --namespace kamixfox --display-name "Kane"
```

`twext login` does the same for an account that already exists. It remembers the namespace, so on the same device you only need the password:

```bash
twext login
```

`twext logout` revokes the session at the hub and then deletes the credentials. If the session was already revoked, it says nothing and moves on.

### Where the Credentials Live

`twext login` and `twext signup` write the hub URL, your namespace, and the session token to `~/.twext/config.json`, created with mode `0600`.

Every hub command can override those three without touching the file, which is what you want in CI:

| Setting   | Flag                | Environment variable |
| --------- | ------------------- | -------------------- |
| Hub URL   | `-u`, `--url`       | `TWEXTHUB_URL`       |
| Namespace | `-n`, `--namespace` | `TWEXTHUB_NAMESPACE` |
| Token     | `--token`           | `TWEXTHUB_TOKEN`     |

The default hub is `https://twexts.sdisk.us/api/v1`. Point `-u` somewhere else and the stored credentials are ignored, because they belong to the hub that issued them. The hub must be served over HTTPS, with the exception of `localhost`, `127.0.0.1`, and `::1` so you can run one while developing.

## ➕ Publishing

Say you're a developer using Twext to create your extensions, and you've just finished creating a new one. But, you don't know where to go to publish it. Here's what you should do to publish your extension to TwextHub:

1. Log in to your account, if you're not already logged in:

   ```bash
   twext login
   ```

2. Publish your extension to TwextHub:

   ```bash
   twext publish
   ```

> **Important:** If this is your first time publishing, your extension will be held for review before it appears for other people. Don't take it personally.

`publish` runs the whole pipeline itself. It validates the project, compiles it, and packs your sources into a gzipped tarball, leaving out `node_modules`, dotfiles, and whatever the last build wrote. The hub unpacks the tarball and runs its own `twext build` on it, so the extension people download is compiled by the hub, not by the copy you just built. If that build fails, the hub's log comes back with the error.

The version comes from `version` in your `twext.yml`, and the extension name from your `@namespace` and `extension.id`. Bump the version before you publish again; a version that's already there can't be published twice.

The first `publish` from a new account also has to accept the hub's Terms of Service, which the command does for you and tells you it did. It only does that with a session from `twext login`, never with a token you passed in.

## 🔔 Checking Your Notifications

If your extension was held for review, you can also check your notifications to see if it has been approved. Notifications are also sent if:

1. An admin announces something to every member
2. An admin approves or declines your extension
3. The terms of service is changed
4. Your account is promoted to admin, or demoted to a user
5. A token of yours has been revoked

```bash
twext notifications
# 2 notifications, 1 unread (newest first)
#   • review.approved (unread): myextension@0.1.0 was approved
```

The command only reads the list. Pass `--read` when you've dealt with them and want the unread markers cleared:

```bash
twext notifications --read
```

## 🔍 Finding Extensions

```bash
twext search utility
# 3 extensions matching "utility"
#   • Super Utilities (@kamixfox/superutilities@1.2.0) — Custom utility blocks for…
```

`--sort` picks the order: `recent`, `downloads`, `updated`, or `name`. With no search terms at all, it lists the whole registry.

`twext info` shows what the registry knows about one extension, its versions, and where to download it. Add a version to narrow it down, and use a range to see every version that matches:

```bash
twext info @kamixfox/superutilities
twext info @kamixfox/superutilities@1.2.0
twext info @kamixfox/superutilities@^1.0
```

Neither `search` nor `info` needs a login. They send the stored token anyway when there is one, which is how the hub knows to include your own extension in the results.

## 📥 Checking Out Sources

`checkout` downloads the sources of a published version into a directory, so you can read, fork, or build someone else's extension:

```bash
twext checkout @kamixfox/superutilities@1.2.0
# Checked out @kamixfox/superutilities@1.2.0 into superutilities
```

The directory defaults to the extension's id, and has to be empty or missing. The extension's own config is named `twext.yml` inside it, so build it with:

```bash
cd superutilities && twext build
```

`checkout` needs a login even for a public extension, and it resolves a range the same way `info` does.

## 🏷️ Managing Versions

These three commands act on the extension in your current directory. They read `extension.id` from `twext.yml` and your namespace from the stored credentials, so run them in the project.

### Moving a Dist-Tag

`latest` is just a tag pointing at a version. Move it, list them, or remove one:

```bash
twext tag set latest 1.4.0
twext tag list
twext tag rm beta
```

A tag name is 1 to 30 letters, digits, or hyphens.

### Deprecating a Version

A deprecation message is shown to anyone who installs the version, which is how you point people at a newer one without pulling the old release out:

```bash
twext deprecate 1.0.0 "Use 1.4.0 instead, this one breaks on costume changes"
```

`twext deprecate 1.0.0 --clear` takes it back off.

### Yanking a Version

`twext yank` deletes a version from the hub for good:

```bash
twext yank 1.0.0
```

Deprecating is the softer option — a yanked version can't be installed by anyone, including people who already depend on it.

## 🤖 Publishing From CI

A session token is tied to the machine that logged in, so don't use one in a workflow. Create an automation token instead, with the scopes it needs:

```bash
twext token create --name ci --scope publish
```

Add `--scope yank` if the workflow also yanks, and `--expires-in-days 90` to give up the token on a schedule. The token is printed once, right there in the terminal:

```bash
TWEXTHUB_TOKEN=twext_... twext publish
```

Keep it in your CI provider's secret store rather than in the repository. The `publish` and `yank` scopes are the only ones that exist, and a token can be revoked from the web UI if it leaks.

> **Important:** A token can't accept the hub's Terms of Service. The first `publish` in a workflow fails until you've published once with `twext login` and agreed to the terms there.

## 👥 Organizations

An organization is a namespace that has owners instead of a password. It can't sign in — the accounts on its owner list act for it, and every one of them has the same rights over it. Use one when a team, a project, or a pile of unrelated extensions should share a namespace.

`twext org create` makes one, and you become its first owner:

```bash
twext org create acme --display-name "Acme" --website https://acme.test
# ✓ Created organization @acme
```

The namespace is shared with accounts, so a name already in use is a conflict the same way it is for `signup`. Like `signup`, creating one needs the current Terms of Service accepted, and the command does that for you when it has a session from `twext login`.

Publishing under it is publishing under any other namespace:

```bash
twext publish --namespace acme
```

### Who Runs It

Add the accounts that should act for the organization, and see who's on the list:

```bash
twext org add acme kamixfox
twext org owners acme
# 2 owners of @acme
#   • Kane (@kamixfox) since 2026-01-02
#   • Alice (@alice) since 2026-03-04
```

Each account you add is notified. The last owner can't be removed, since a namespace nobody owns can't be changed at all — hand it to another account, or delete the organization.

### Editing the Profile

The profile is the display name, bio, website, and GitHub username. `org info` shows what's there now:

```bash
twext org info acme
# Acme (@acme)
#   Blocks for TurboWarp
#   https://acme.test
#   github.com/acme
#   created 2026-01-02
```

`twext org update` changes whichever of those you pass and leaves the rest alone. Pass a field as an empty string to clear it:

```bash
twext org update acme --bio "Blocks for TurboWarp" --website ""
```

The avatar and banner aren't CLI flags; set them from the web UI.

`twext org list` lists every organization on the hub, and `twext org extensions acme` lists what one of them has published, with the same `--sort` and an extra `--license` filter:

```bash
twext org extensions acme --sort downloads --license MIT
```

### Deleting One

`twext org delete` takes the whole namespace down: every extension, version, image, and webhook under it, along with the owner rows. It needs `--force` to say that's what you meant:

```bash
twext org delete acme --force
```

This can't be undone from the CLI. The names aren't redirected anywhere, so `@acme/<id>` stops resolving for anyone who has it installed.
