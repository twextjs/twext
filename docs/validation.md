# 🔍 Validation

`twext validate` checks a project without writing anything. `twext build` runs the same checks first and stops before compiling if any of them fail, so a broken build never gets written.

```bash
twext validate
# ✓ 5 blocks validated
```

Errors fail the command with exit code 1. Warnings are printed and the command still succeeds.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [🧾 What Gets Checked](#-what-gets-checked)
  - [Unknown Fields Are Errors](#unknown-fields-are-errors)
  - [The Manifest and the Code](#the-manifest-and-the-code)
- [🔬 Free Variables](#-free-variables)
- [⚠️ Warnings](#-warnings)
- [🚫 What It Doesn't Check](#-what-it-doesnt-check)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 🧾 What Gets Checked

The manifest has to load and name the right things:

- `twext.yml` is readable, defines an `entryPoint`, and the entry point loads as an ES module.
- The entry point exports a `blocks` map.
- `extension` is present, and `extension.id` is 1 to 64 lower-case letters and digits.
- `extension.className` is a valid JavaScript identifier and not a reserved word, if it's set.
- `extension.isUnsandboxed` is a boolean, if it's set.
- `blocks` has at least one entry, and every entry is a block mapping, a `---` separator, or a label.
- Every `extension.menus` value is a list of items, a menu mapping with `items` and an optional boolean `acceptReporters`, or the name of a method, and every item is a string or a `{ text, value }` mapping of strings.

### Unknown Fields Are Errors

Every key under `extension`, a block, an argument, and a menu has to be one Twext knows about. A key it doesn't recognize is an error, because the alternative is a field that passes every check and then quietly never reaches the built file:

```yaml
blocks:
  - opcode: logMessage
    blockType: command
    text: "log [MESSAGE]"
    isTermnal: true
```

```bash
✗ Block "logMessage" has unknown field "isTermnal"; did you mean "isTerminal"?
```

A label only accepts `blockType` and `text`, and a button only accepts `blockType`, `text`, `filter`, and `func`. The fields above `extension` itself — `name`, `version`, `author`, and whatever else you keep in `twext.yml` — are still yours, and are never checked.

### The Manifest and the Code

- Every executable block names an `opcode`, and no opcode is used twice.
- No opcode or `func` is `constructor` or `getInfo`, which the compiler generates.
- Every opcode has a function under the same key in the `blocks` map the entry point exports.
- Every button names a `func`, and every dynamic menu names a method, that the compiled extension actually publishes — a `methods` entry, or the handler of a block the manifest declares.
- Nothing in the `methods` export is `constructor` or `getInfo`, and every entry of it is a function.
- No block's `func` or `opcode` is a name already used by the `methods` export, which would leave the block without a handler.
- Every `blockType` is one Twext knows.
- Every block's `text` is a string.
- Every block's `arguments` is a mapping of names to mappings.
- Every argument's `type` is one Twext knows, and every `menu` names a menu declared in `extension.menus`.
- `isTerminal`, `hideFromPalette`, `disableMonitor`, `isDynamic`, `isEdgeActivated`, and `shouldRestartExistingThreads` are booleans, `filter` holds only `"sprite"` and `"stage"`, and `branchCount` is a whole number of 1 or more.
- An `image`, `costume`, or `sound` argument carries a `dataURI`, because without one it renders as an empty slot.
- An `event` block sets `isEdgeActivated: false`, which TurboWarp requires and otherwise never fires.

A handler exported under a key that no block declares is a warning, not an error. The handler is left out of the compiled file, so nothing breaks — but if you meant to add the block, you haven't.

## 🔬 Free Variables

The check worth knowing about is the one that isn't a typo check.

Twext parses `setup`, every handler, and every entry in `methods` with [espree](https://github.com/eslint/espree) and [eslint-scope](https://github.com/eslint/eslint-scope), collects the names each one reads but never declares, and compares them against the names that will exist in the compiled extension. A handler that reads a name that won't be there is a build error instead of a `ReferenceError` inside a Scratch project:

```mjs
// src/blocks/greeting.js
export function sayHello({ WHO }) {
  console.log(prefix, WHO);
}
```

```bash
✗ Handler "sayHello" references "prefix", which is not defined in the compiled extension; put shared state in "setup" or inline it
```

A name is available if it is:

- Declared at the top level of `setup`.
- `Scratch`.
- A JavaScript built-in or browser global — the ES2027 globals, `undefined`, `NaN`, `Infinity`, `globalThis`, `arguments`, and everything in the browser global set. That covers `console`, `Math`, `JSON`, `setTimeout`, `fetch`, and the rest of the standard library.

Nothing else is. The import that brought a helper into your module doesn't carry over, the module-level `const` next to it doesn't either, and one handler can't call another. [Setup](./writing-blocks.md#-setup) is where that state goes, and a shared helper that's called by a handler belongs in `methods` or in `setup`.

`setup` gets the same treatment. Its parameters are dropped when it's compiled, since it's called with nothing, so a parameter it uses is an error too:

```bash
✗ setup references "helper", which is not defined in the compiled extension
```

## ⚠️ Warnings

Four things warn instead of failing:

- `extension.name is missing; falling back to the project name`
- `extension.className is missing; deriving it from the id`
- `Handler "<opcode>" is exported but not declared in twext.yml`
- `Block "<opcode>" restarts existing threads on an edge-activated hat, which TurboWarp ignores`

## 🚫 What It Doesn't Check

Validation reads the manifest and the source. It has nothing to do with a running Scratch project, so it doesn't check:

- Whether the block text and the argument names line up. TurboWarp matches each `[NAME]` in `text` to a key of `arguments`; Twext passes both through and leaves it there.
- Whether the handler's parameters are the ones you meant to destructure.
- Whether a handler does the right thing with the arguments or calls TurboWarp's API correctly.
- Whether the compiled file runs. Load the built extension in TurboWarp for that.

One more shape of error comes from the compiler rather than the validator: a handler that Twext can't re-print from its source — a generator, for instance — passes `twext validate` and fails the build with `Could not parse handler function for block "<opcode>"`, or `... for method "<name>"` for an entry in `methods`. See [Handlers](./writing-blocks.md#-handlers).
