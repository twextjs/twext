# 🧱 Writing Blocks

The `entryPoint` module in `twext.yml` holds the code. It exports a `blocks` map that pairs each opcode in the manifest with a handler function, a `methods` map for anything else the extension publishes, and a `setup` function that runs once when the extension loads.

Twext doesn't bundle the module graph. It reads each handler's source, moves the bodies into a generated extension class, and writes one file. Knowing that explains most of the rules below.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [📥 The Entry Point](#-the-entry-point)
- [🧩 Handlers](#-handlers)
- [🧰 Methods](#-methods)
- [🔧 Setup](#-setup)
- [🌍 What a Handler Can See](#-what-a-handler-can-see)
- [📤 What Gets Written](#-what-gets-written)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 📥 The Entry Point

Twext loads the entry point with `import()`, so it has to be an ES module. Use `"type": "module"` in the project's `package.json`, or name the files `.mjs`.

```mjs
// src/index.js
import { sayHello } from "./blocks/greeting.js";

export const blocks = {
  sayHello,
};

export function setup() {
  console.log("[Greeter] loaded");
}
```

`blocks` is required. It's an object whose keys are opcodes and whose values are the handlers for those blocks, so every opcode in `twext.yml` needs an entry here and every entry here needs an opcode in the manifest. Twext won't guess: a missing handler is a build error, and a handler with no block is a warning.

`setup` is optional and takes no arguments. See [Setup](#-setup).

`methods` is optional and holds everything the manifest points at that isn't a block: dynamic menu functions and button targets, plus any shared helpers you want on the extension object. See [Methods](#-methods).

The key in the map is what matters, not the name of the export. This compiles a `sayHello` method:

```mjs
export const blocks = {
  sayHello: doTheGreeting,
};
```

## 🧩 Handlers

A handler is a plain function or an arrow function. Twext re-prints it from its source, keeping the parameter list, the `async` keyword, and the body:

```mjs
// src/blocks/greeting.js
export function sayHello({ WHO }, util) {
  console.log("Hello, " + WHO);
}
```

- The first argument holds the block's argument values, keyed by the argument names in `twext.yml`. Destructuring works because the parameter list is kept as written.
- The second argument is TurboWarp's `util` object. See the [TurboWarp documentation](https://docs.turbowarp.org/) for what it offers.
- What a handler returns is the block's result. Reporters return a value; commands return nothing.

A handler that refers to something from its own module won't work:

```mjs
// ✗ `logger` is a module-level const in this file, and the module isn't in
// the compiled output at all.
const logger = console;
export function sayHello({ WHO }) {
  logger.log(WHO);
}
```

The build fails with a free-variable error naming `logger`. Anything a handler needs at runtime has to be declared in `setup`, which is the next section.

Twext can only re-print a handful of function shapes: `function name() {}`, `function () {}`, the method shorthand `name() {}`, and arrows with a block or expression body, each optionally `async`. A generator can't be re-printed, and neither can a function whose source was rewritten on the way in, so the build stops with `Could not parse handler function for block "<opcode>"`, or `... for method "<name>"` for an entry in `methods`. Keep handlers and methods as plain functions in your own modules.

## 🧰 Methods

`methods` is a second export, keyed by the name the manifest uses to call each function. Twext publishes those on the generated extension class next to the block handlers:

```mjs
export const methods = {
  layerNames() {
    return ["Background", "Foreground"];
  },
  RESET_ALL() {
    state.resets += 1;
  },
};
```

Two manifest features need it. A [dynamic menu](./configuration.md#dynamic-menus) names a method to produce its items, and a [button](./configuration.md#buttons) names a method to run when it's clicked:

```yaml
extension:
  menus:
    layers: layerNames
blocks:
  - blockType: button
    text: "reset everything"
    func: RESET_ALL
```

Nothing in `methods` may be named `constructor` or `getInfo`, and the same applies to an opcode and to a block's `func`. A block that sets `func` is published under that name instead of its opcode, which is how you keep an old opcode in project JSON while renaming the code behind it.

Methods follow the same rules as handlers: they're re-printed from source rather than bundled, and they can only reference what [Setup](#-setup) declares and the runtime globals. Shared helpers that handlers call belong here or in `setup`.

## 🔧 Setup

`setup` is where shared state and constants live. It runs once, when the extension loads, and the declarations at its top level are the names every handler can use.

It can be a function, a string of source, or an array of either:

```mjs
// As a function
export function setup() {
  const prefix = "[Greeter]";
  const state = { greeted: 0 };
}
```

```mjs
// As source, which is the only way to attach a comment to the code
export const setup = `
  // Shared by every handler in this extension.
  const prefix = "[Greeter]";
  const state = { greeted: 0 };
`;
```

```mjs
// As an array, when the source comes from somewhere else
export const setup = [loadFromConfig(), "const state = { greeted: 0 };"];
```

A function's parameters are dropped, since `setup` is called with nothing. Anything it needs has to be a top-level declaration in the compiled output, which is `setup` itself plus the runtime globals.

The declarations are ordinary `const`, `let`, `var`, `function`, and `class` bindings at the top level of the setup code. Handlers can read and write them:

```mjs
// src/blocks/greeting.js
export function sayHello({ WHO }) {
  state.greeted += 1;
  console.log(prefix, `${WHO} (${state.greeted})`);
}
```

A handler referencing a name that isn't in `setup`, isn't a global, and isn't `Scratch` is a build error. [Validation](./validation.md) has the full list of what a handler can see.

## 🌍 What a Handler Can See

- The names declared at the top level of `setup`.
- `Scratch`, the TurboWarp global the compiled file is wrapped around.
- The JavaScript built-ins and browser globals TurboWarp runs in — `console`, `Math`, `JSON`, `setTimeout`, `fetch`, `TextEncoder`, and the rest of the standard library.
- Its own parameters, and anything they bring in.

`methods` see the same list.

Imports and module-level bindings in your own files are not in that list, because the modules they live in aren't in the compiled output.

## 📤 What Gets Written

For the manifest and entry point below:

```yaml
# twext.yml (abridged)
extension:
  id: "greeter"
  name: "Greeter"
  className: "GreeterExtension"
  color1: "#0070F3"

blocks:
  - opcode: sayHello
    blockType: command
    text: "say hello to [WHO]"
    arguments:
      WHO:
        type: string
        defaultValue: "world"
```

```mjs
// src/index.js
import { sayHello } from "./blocks/greeting.js";

export const setup = `
  const prefix = "[Greeter]";
`;

export const blocks = { sayHello };
```

`twext build` writes this to `dist/extension.js`:

```js
(function (Scratch) {
  "use strict";

  const prefix = "[Greeter]";

  class GreeterExtension {
    getInfo() {
      return {
        id: "greeter",
        name: "Greeter",
        color1: "#0070F3",
        blocks: [
          {
            opcode: "sayHello",
            blockType: Scratch.BlockType.COMMAND,
            text: "say hello to [WHO]",
            arguments: {
              WHO: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "world",
              },
            },
          },
        ],
      };
    }

    sayHello({ WHO }) {
      console.log(prefix, `Hello, ${WHO}!`);
    }
  }

  Scratch.extensions.register(new GreeterExtension());
})(Scratch);
```

The file is what TurboWarp loads, and nothing in it is a bundle of your project — there's no module registry, no `import`, and no `export` in the output. Add the compiled file to TurboWarp as an unsandboxed extension, or set `extension.isUnsandboxed` in `twext.yml` and the built file throws when TurboWarp loads it into the sandbox instead.

> **Important:** `twext publish` sends your sources to TwextHub, not this file. The hub runs its own `twext build` on what it receives.
