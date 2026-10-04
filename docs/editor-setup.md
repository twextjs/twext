# 🧑‍💻 Editor Setup

Twext ships two things your editor can use: a JSON Schema for `twext.yml`, and TypeScript definitions for the entry point module. Neither is required to build an extension.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [📝 Validating `twext.yml`](#-validating-twextyml)
- [🔍 Checking the JavaScript](#-checking-the-javascript)
- [🧰 Keeping Validation Close](#-keeping-validation-close)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 📝 Validating `twext.yml`

The schema is at `schema/twext.json` inside the package, so it becomes `node_modules/@twextjs/twext/schema/twext.json` in a project that installed it.

In VS Code, install the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) by Red Hat and add this to your workspace:

```jsonc
// .vscode/settings.json
{
  "yaml.schemas": {
    "./node_modules/@twextjs/twext/schema/twext.json": ["twext.yml"],
  },
}
```

Now the editor completes field names, flags a `blockType` that isn't one of the real ones, and warns when a required field is missing — before you run anything.

The schema is a plain draft-07 JSON Schema, so any editor that can point at a schema for a YAML file can use it. The mapping key is the path to the schema and the value is the file pattern it applies to.

> **Note:** The schema covers the shape of the manifest. Whether an `opcode` has a handler behind it, or whether a handler refers to a name that doesn't exist, is what `twext validate` is for.

## 🔍 Checking the JavaScript

The package exports types for the entry point. Point `jsconfig.json` at them and turn on JavaScript checking to get the same completion and error reporting in your source files:

```json
// jsconfig.json
{
  "compilerOptions": {
    "checkJs": true,
    "noEmit": true
  }
}
```

```js
// src/index.js
/** @type {import("@twextjs/twext/types/extension").Blocks} */
const blocks = {
  hello: (args, util) => "Hello, world!",
};

export { blocks };
```

Or annotate a single export, which is usually enough:

```js
// src/index.js
/** @type {import("@twextjs/twext/types/extension").Setup} */
export const setup = "const state = { hits: 0 };";
```

The definitions available are:

| Type          | What it describes                                                    |
| ------------- | -------------------------------------------------------------------- |
| `Handler`     | A block handler: `(args, util) => unknown`.                          |
| `HandlerArgs` | The argument values, keyed by the names in `twext.yml`.              |
| `Util`        | TurboWarp's `util` object.                                           |
| `Blocks`      | The `opcode` to handler map that `entryPoint` exports.               |
| `Setup`       | The `setup` export: a function, a string, or an array of strings.    |
| `Extension`   | The whole entry point shape: a `blocks` map and an optional `setup`. |

## 🧰 Keeping Validation Close

Autocomplete isn't a substitute for the real check. `twext validate` reads the manifest, loads the entry point, and analyzes the source, which no schema can do. It's fast enough to run on save:

```bash
twext validate
```

If your editor can run a command on save — VS Code with a `runOnSave` task, or a file-watcher like `watchexec` — that's a reasonable way to get the errors where you're already looking.
