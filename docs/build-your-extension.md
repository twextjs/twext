# ➕ Build Your Extension

> **Important:** To create extensions with Twext, you'll need to know both JavaScript and its ESM syntax. Ideally, you should also know how to code TurboWarp extensions without using Twext, but it's not required.

For the sake of this tutorial, we won't be using `twext init`. But, the init script is a great way to get started when you know how to use Twext.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [🧑‍💻 Steps](#-steps)
- [🔤 Adding an Argument](#-adding-an-argument)
- [📋 Adding a Menu](#-adding-a-menu)
- [🗂️ Organizing the Palette](#-organizing-the-palette)
- [🧬 Sharing State Between Blocks](#-sharing-state-between-blocks)
- [⏭️ Where to Go From Here](#-where-to-go-from-here)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 🧑‍💻 Steps

1. Install Twext, if you haven't already:

   ```bash
   npm install --save-dev @twextjs/twext
   ```

2. Create your Twext configuration:

   1. Create the `twext.yml` file.
   2. Copy these contents to it:

      ```yaml
      name: "Your Extension"
      version: "0.1.0" # Has to be SemVer!
      description: "This is your extension."
      author: "Your Name"
      license: "Apache-2.0" # Recommended license

      entryPoint: "src/index.js"
      outputPath: "dist/extension.js"

      extension:
        id: "myextension" # Only numbers and letters, nothing else
        name: "My Extension"
        className: "MyExtension" # Pascal case is recommended
        color1: "#0070F3"

      blocks:
        - opcode: hello
          blockType: reporter
          text: "say hello"
      ```

3. Create the `src/index.js` file:

   ```mjs
   import { hello } from "./blocks/hello.js";

   export const blocks = {
     // Required to make sure Twext knows what functions are blocks and what functions aren't
     hello,
   };

   export function setup() {
     // Your setup script. We won't put anything in here for now.
   }
   ```

4. Create the `src/blocks/hello.js` file:

   ```mjs
   export function hello() {
     return "Hello, TurboWarp!";
   }
   ```

   Anything a handler returns is what the block reports back into the project.

5. Finally, build your extension with Twext:

   ```bash
   npx twext # or twext build
   ```

6. Add `dist/extension.js` to TurboWarp as an unsandboxed extension, and you should see a `say hello` reporter in the palette.

While you're iterating, `twext dev` rebuilds on every save and serves the extension at a URL you add to TurboWarp once, so you don't have to rebuild and re-add the file each time:

```bash
npx twext dev
```

The best way to learn how to code extensions with Twext is to experiment with the tool. If you find anything wrong, or a behavior is there that you think should be changed, please make an issue.

## 🔤 Adding an Argument

A block takes input through arguments. Declare the name, the type, and an optional default in the manifest, and read it off the first parameter of the handler:

```yaml
blocks:
  - opcode: greet
    blockType: command
    text: "greet [WHO]"
    arguments:
      WHO:
        type: string
        defaultValue: "world"
```

```mjs
// src/blocks/hello.js
export function greet({ WHO }) {
  console.log("Hello, " + WHO + "!");
}
```

The argument name is what connects the two sides: the `[WHO]` in the block's text, the `WHO` key in `arguments`, and the `WHO` you destructure in the handler all have to be the same. Twext hands you an object keyed by those names, so you can also read `args.WHO` instead of destructuring.

The type decides what the block's input looks like. Alongside `string`, there's `number`, `boolean`, `angle`, `color`, `matrix`, and `note` — the full list is in [Twext Configuration](./configuration.md#-arguments).

## 📋 Adding a Menu

A menu is a dropdown of choices, declared once and used by any number of arguments:

```yaml
extension:
  id: "myextension"
  name: "My Extension"
  menus:
    volume:
      - "quiet"
      - "normal"
      - "loud"

blocks:
  - opcode: setVolume
    blockType: command
    text: "set volume to [VOLUME]"
    arguments:
      VOLUME:
        type: string
        menu: volume
```

The handler gets whichever item the user picked as a string, so a plain list of strings is usually all you need. When the text on screen shouldn't be the value your code receives, use the `text` and `value` form:

```yaml
extension:
  menus:
    speed:
      items:
        - text: "Walk"
          value: "0.5"
        - text: "Run"
          value: "1.5"
```

## 🗂️ Organizing the Palette

Blocks show up in the order you list them, so you can group them with labels and separators:

```yaml
blocks:
  - blockType: label
    text: "Basics"
  - opcode: hello
    blockType: reporter
    text: "say hello"
  - opcode: greet
    blockType: command
    text: "greet [WHO]"
    arguments:
      WHO:
        type: string
  - "---"
  - blockType: label
    text: "Utilities"
  - opcode: setVolume
    blockType: command
    text: "set volume to [VOLUME]"
    arguments:
      VOLUME:
        type: string
        menu: volume
```

A label needs no opcode and has no code behind it. A `"---"` entry is a plain separator line.

## 🧬 Sharing State Between Blocks

Twext compiles each handler into the extension class, so the module they're imported from isn't there at runtime. A handler that reads a name from its own file fails the build:

```bash
✗ Handler "sayHello" references "prefix", which is not defined in the compiled extension; put shared state in "setup" or inline it
```

Constants and shared state go in `setup` instead, which runs once when the extension loads. Anything declared at its top level is available to every handler:

```mjs
// src/index.js
import { greet, countGreeting } from "./blocks/hello.js";

export const setup = `
  const prefix = "[My Extension]";
  const stats = { greetings: 0 };
`;

export const blocks = {
  greet,
  countGreeting,
};
```

```mjs
// src/blocks/hello.js
export function greet({ WHO }, util) {
  stats.greetings += 1;
  console.log(prefix, "greeting", WHO);
}

export function countGreeting() {
  return stats.greetings;
}
```

`console` works because it's one of the globals the extension runs with. Your own module-level `const` does not, because the module isn't in the compiled output. [Writing Blocks](./writing-blocks.md) has the full list of names a handler can see.

## ⏭️ Where to Go From Here

- [Twext Configuration](./configuration.md): every field in `twext.yml`, including the block types and argument types you didn't use here.
- [Writing Blocks](./writing-blocks.md): how handlers and `setup` end up in the compiled file, and the shapes Twext can re-print.
- [Validation](./validation.md): what `twext validate` catches, including the free-variable check.
- [CLI Reference](./cli.md): the flags on every command.
- [Using TwextHub](./twexthub.md): publishing what you just built.
