# 📦 Twext

[![CI](https://github.com/twextjs/twext/actions/workflows/ci.yml/badge.svg)](https://github.com/twext/cli/actions/workflows/ci.yml) [![CD](https://github.com/twextjs/twext/actions/workflows/cd.yml/badge.svg)](https://github.com/twext/cli/actions/workflows/cd.yml)

> _Build custom TurboWarp extensions with JavaScript modules (ESM)._

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [🌟 Highlights](#-highlights)
- [ℹ️ Overview](#-overview)
  - [✍️ Authors](#-authors)
- [🚀 Usage](#-usage)
- [⬇️ Installation](#-installation)
  - [Prerequisites](#prerequisites)
  - [Steps](#steps)
- [💭 Feedback and Contributing](#-feedback-and-contributing)
- [Also See...](#also-see)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 🌟 Highlights

- Built output looks almost identical to extensions that were not built with Twext.
- The CLI can also validate your extension, checking for inconsistencies or errors in your configuration.
- You can publish to a registry of extensions that were also created with Twext using the CLI. [Read more about TwextHub.](./docs/twexthub.md)

## ℹ️ Overview

Large JavaScript projects are usually multiple files. TurboWarp extensions should be the same, but they aren't.

Twext is a zero-config custom TurboWarp extension build tool meant to solve the problem that _large extensions get harder to build the larger they are_. With Twext, you can use ESM syntax to build an extension, instead of coding one in one file.

### ✍️ Authors

> **AI Disclosure:** AI was used in the development of Twext.

- [@kamixfox](https://github.com/kamixfox)

## 🚀 Usage

1. Install Twext using `npm` (_from source_):

   ```bash
   npm install
   ```

2. Scaffold your project:

   ```bash
   node src/cli.js init
   ```

3. Build the scaffolded extension:

   ```bash
   node src/cli.js # or twext build
   ```

To learn how to use Twext _and_ build a functioning extension at the same time, see [Build Your Extension.](./docs/build-your-extension.md)

## ⬇️ Installation

### Prerequisites

To install Twext, you will need:

1. A computer running Windows, MacOS, or a Linux distro.
2. Node.js (recommended v24) installed with `npm`.

### Steps

Install with `npm`:

```bash
npm install @twextjs/twext
```

## 💭 Feedback and Contributing

Discussions are turned off here, just open an issue if you have a question, or if you find a bug/a new feature to add.

If you want to contribute to this project, feel free! See the [Development Guide.](./docs/development.md)

## Also See...

- [Documentation](./docs/index.md)
- [CLI Reference](./docs/cli.md)
- [Twext Configuration](./docs/configuration.md)
- [Agent Guide](./AGENT.md)
