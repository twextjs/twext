# ⚙️ Twext Configuration

Every Twext project has a `twext.yml` manifest. Twext reads the block palette, the arguments, and the extension metadata out of it, and `twext build` writes the compiled extension to `outputPath`.

Paths in the manifest — `entryPoint` and `outputPath` — are resolved relative to the manifest's own directory, so a project can be built from any working directory with `twext build -c path/to/twext.yml`.

Here is a manifest that uses every field:

```yaml
name: "super-utilities"
version: "1.0.0"
description: "Custom utility blocks for TurboWarp projects"
author: "Your Name"
license: "Apache-2.0"

entryPoint: "src/index.js"
outputPath: "dist/extension.js"

extension:
  id: "superutilities"
  name: "Super Utilities"
  className: "SuperUtilitiesExtension"
  color1: "#FF4D4D"
  color2: "#E60000"
  color3: "#B30000"
  docsURI: "https://example.com/super-utilities/docs"
  menuIconURI: "https://example.com/super-utilities/menu.svg"
  blockIconURI: "https://example.com/super-utilities/button.svg"

  menus:
    sizes:
      acceptReporters: true
      items:
        - "small"
        - "medium"
        - text: "Large"
          value: "lg"
    layers:
      acceptReporters: true
      items: layerNames

blocks:
  - opcode: logMessage
    blockType: command
    text: "log [MESSAGE] to console"
    isTerminal: true
    arguments:
      MESSAGE:
        type: string
        defaultValue: "Hello TurboWarp!"
  - "---"
  - blockType: label
    text: "Custom Utilities"
  - opcode: setSize
    blockType: command
    text: "set size to [SIZE]"
    filter:
      - "sprite"
    arguments:
      SIZE:
        type: string
        menu: sizes
  - opcode: setLayer
    blockType: command
    text: "set layer to [LAYER]"
    arguments:
      LAYER:
        type: string
        menu: layers
  - opcode: stampLogo
    blockType: command
    text: "stamp the logo"
    blockIconURI: "https://example.com/super-utilities/stamp.svg"
    arguments:
      LOGO:
        type: image
        dataURI: "data:image/png;base64,..."
        flipRTL: true
  - blockType: button
    text: "reset everything"
    func: RESET_ALL
```

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [📦 Project Fields](#-project-fields)
- [🧩 The `extension` Section](#-the-extension-section)
- [🧱 Blocks](#-blocks)
  - [Block Types](#block-types)
  - [Buttons](#buttons)
- [🔤 Arguments](#-arguments)
- [📋 Menus](#-menus)
  - [Dynamic Menus](#dynamic-menus)
- [🔗 How the Manifest Connects to the Code](#-how-the-manifest-connects-to-the-code)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 📦 Project Fields

- `name`: Project name. Used as the fallback for `extension.name`.
- `version`: Project version, as a string. It has to be SemVer. `twext publish` sends this to TwextHub as the published version.
- `description`: Short description of the extension.
- `author`: Author name or GitHub handle.
- `license`: SPDX license identifier. The `twext init` scaffold writes `MIT`. Twext doesn't check the value, and it isn't part of the compiled output.
- `entryPoint`: Path to the module that exports the `blocks` map. Required.
- `outputPath`: Where `twext build` writes the compiled extension. Defaults to `dist/extension.js`.

Only `entryPoint`, `extension`, and `blocks` are required. Anything else in the manifest is carried along untouched, so a project can keep its own fields in `twext.yml`.

> **Note:** The compiled extension's `getInfo()` includes the `id`, the `name`, the block colors, the menus, the icons and documentation links, and the block definitions. The project fields above are for you and for the registry — they don't end up in the built file.

Every key under `extension`, a block, an argument, and a menu has to be one Twext knows about. An unknown key is a build error with a suggestion when the name looks like a typo, rather than a field that quietly disappears between `twext.yml` and the built file.

## 🧩 The `extension` Section

- `id`: Stable ID TurboWarp uses to identify the extension. Required, 1 to 64 lower-case letters and digits (`a-z`, `0-9`) — the same rule TwextHub enforces. It can't be changed without breaking existing projects.
- `name`: Name shown in the block palette. Falls back to the project `name`, then to the `id`.
- `className`: Name of the generated extension class. Must be a valid JavaScript identifier and not a reserved word. When it's missing, Twext appends `Extension` to the PascalCase `id` and prefixes `_` if the resulting name starts with a digit.
- `color1`: Primary block color, as `#rrggbb`. Defaults to `#0070F3`.
- `color2`: Secondary block color. Left out of the output when it isn't set.
- `color3`: Tertiary block color. Left out of the output when it isn't set.
- `docsURI`: Link to your documentation. TurboWarp shows it as a **Documentation** entry at the bottom of the extension's menu.
- `menuIconURI`: Icon shown next to the extension's name in the block palette.
- `blockIconURI`: Icon shown on the extension's button in the block palette.
- `menus`: Dropdowns that block arguments select from. See [Menus](#-menus).

## 🧱 Blocks

`blocks` is a list, and the order is the order of the block palette. Three kinds of entries go in it:

1. A block mapping, which pairs an `opcode` with its handler.
2. A `"---"` string, which draws a horizontal separator in the palette.
3. A `label` block, which draws a bold caption and needs no opcode.

A block mapping takes these fields:

- `opcode`: Name of the handler's key in the `blocks` map the entry point exports. Required on every executable block, and it can't be `constructor` or `getInfo` — both names belong to the generated class. Buttons and labels don't have one.
- `blockType`: One of the types below. Defaults to `reporter`.
- `text`: Label shown on the block. Defaults to the opcode. TurboWarp reads `[NAME]` in this string and matches it to the keys of `arguments`; Twext passes the text through without checking that the names line up.
- `arguments`: Mapping of argument name to argument definition. See [Arguments](#-arguments).

These optional fields are passed straight through to `getInfo()`:

- `func`: Name the generated method is published under. Defaults to `opcode`. See [Buttons](#buttons).
- `hideFromPalette`: Keeps the block out of the palette while leaving it usable in projects that already use it.
- `blockIconURI`: Icon shown on the block itself.
- `filter`: List of `"sprite"` and/or `"stage"`, restricting the block to those targets. Omit it to allow both.
- `isDynamic`: Marks the block as dynamic, which lets the editor and the extension inspector target it by name.
- `isTerminal`: Stops the script after the block runs instead of carrying on to the next block. Command blocks only.
- `disableMonitor`: Hides the block's monitor while it's being dragged out. Reporters only.
- `isEdgeActivated`: Whether a hat fires for every matching target instead of only fresh ones. Defaults to `true`, and event blocks have to set it to `false`.
- `shouldRestartExistingThreads`: Restarts already-running threads for a target instead of letting them finish. Hats only, and TurboWarp ignores it on an edge-activated hat.
- `branchCount`: Number of branches on a C-shaped `cond` or `loop` block. Defaults to 1.

### Block Types

| `blockType`      | TurboWarp constant              |
| ---------------- | ------------------------------- |
| `command`        | `Scratch.BlockType.COMMAND`     |
| `reporter`       | `Scratch.BlockType.REPORTER`    |
| `boolean`        | `Scratch.BlockType.BOOLEAN`     |
| `hat`            | `Scratch.BlockType.HAT`         |
| `event`          | `Scratch.BlockType.EVENT`       |
| `loop`           | `Scratch.BlockType.LOOP`        |
| `cond`, `cblock` | `Scratch.BlockType.CONDITIONAL` |
| `button`         | `Scratch.BlockType.BUTTON`      |
| `label`          | `Scratch.BlockType.LABEL`       |

`cond` and `cblock` are the same block type under two names.

A `label` only takes `blockType` and `text`; it draws a bold caption and compiles to a `Scratch.BlockType.LABEL` block with no method behind it.

### Buttons

A `button` is the one block type with no `opcode`. It draws a clickable button in the palette and calls a method by name when it's pressed, which is how extensions expose things the palette has no block for:

```yaml
blocks:
  - blockType: button
    text: "reset everything"
    func: RESET_ALL
```

A button takes `blockType`, `text`, `filter`, and `func`. `func` is required and names a function the entry point publishes, which means one in `methods` or a handler for a block you also declare; see [How the Manifest Connects to the Code](#-how-the-manifest-connects-to-the-code).

## 🔤 Arguments

An argument definition takes these fields:

- `type`: One of `string`, `text`, `number`, `boolean`, `angle`, `color`, `matrix`, `note`, `image`, `costume`, or `sound`. Defaults to `string`. `text` is a second name for `string`.
- `defaultValue`: Value used when the argument is left empty. It's written into the built file as-is, so a YAML number stays a number and a quoted string stays a string.
- `menu`: Name of a menu in `extension.menus` that this argument selects from. The argument keeps its `type` in the output, so the type still has to be a known one.
- `dataURI`: The argument's own asset, as a data URI. Required for `image`, `costume`, and `sound` arguments, which is how you ship a sprite picker, a costume, or a sound picker without uploading anything separately.
- `flipRTL`: Mirrors the asset when the project is right-to-left. Image and costume arguments only.

An argument without a `type` is compiled as a string argument, which is what most blocks want.

```yaml
- opcode: stampLogo
  blockType: command
  text: "stamp the logo"
  arguments:
    LOGO:
      type: image
      dataURI: "data:image/png;base64,..."
      flipRTL: true
```

## 📋 Menus

Menus are declared in `extension.menus` as a mapping of menu names to definitions. A menu argument refers back to the menu by name.

A menu can be a plain list of items, which is shorthand for a menu with nothing but `items`:

```yaml
extension:
  menus:
    sizes:
      - "small"
      - "medium"
      - "large"
```

Or a mapping, which is the only way to set `acceptReporters`:

```yaml
extension:
  menus:
    sizes:
      acceptReporters: true
      items:
        - "small"
        - "medium"
        - "large"
```

- `acceptReporters`: Whether reporter blocks can be dropped into the menu. Almost always `true`. It isn't set at all when the menu is a plain list.
- `items`: The menu's items. Each item is either a string, which is displayed and passed to the block as-is, or a `{ text, value }` mapping, which displays `text` and hands `value` to the block.

The `{ text, value }` form is what you want when the value the block receives shouldn't be the text on screen:

```yaml
extension:
  menus:
    easing:
      items:
        - text: "Linear"
          value: "linear"
        - text: "Ease in and out"
          value: "ease-in-out"
```

A block argument that names a menu Twext doesn't know about is a build error, so a typo in the menu name never reaches the block palette.

### Dynamic Menus

A menu can also be a function name, in which case TurboWarp calls it every time the dropdown is opened instead of using a fixed list. That's what you want for lists that depend on the project, like the sprite layers a user actually has:

```yaml
extension:
  menus:
    layers: layerNames

    easing:
      acceptReporters: true
      items: easingNames
```

Both forms are shorthand for the mapping form, so `layers: layerNames` is the same as `layers: { items: layerNames }`. The name has to match a function in the entry point's `methods` export, and the function has to return the same shape a static `items` list would — an array of strings, an array of `{ text, value }` mappings, or both mixed.

A menu that names a function Twext can't find is a build error.

## 🔗 How the Manifest Connects to the Code

Every executable block in `blocks` needs a handler function under the same `opcode` in the `blocks` map that `entryPoint` exports. A missing handler is a build error, and a handler that isn't declared in the manifest is a warning — it doesn't get compiled, so it never reaches the block palette.

The entry point can also export a `methods` map. Twext publishes those on the generated extension class alongside the block handlers, which is how dynamic menus and buttons get something to call:

```js
export const blocks = {
  setLayer(args) {
    return args.LAYER;
  },
};

export const methods = {
  layerNames() {
    return ["Background", "Foreground"];
  },
  RESET_ALL() {
    // Called by the palette button.
  },
};
```

`methods` is where shared helpers belong too, and a helper called from a handler is subject to the same free-variable rules as the handler itself.

A block can rename the method it's published as with `func`, which is useful when the opcode you want in project JSON isn't the name your code uses:

```yaml
- opcode: legacyLayerName
  func: setLayer
  blockType: command
  text: "set layer to [LAYER]"
  arguments:
    LAYER:
      type: string
      menu: layers
```

Nothing in `methods` may be called `constructor` or `getInfo`, and neither may an opcode, a `func`, or a menu function name.

`setup` runs once when the extension loads, before any block runs, and the declarations at its top level are the names handlers are allowed to reference. That's covered in [Writing Blocks](./writing-blocks.md), and the checks themselves are in [Validation](./validation.md).
