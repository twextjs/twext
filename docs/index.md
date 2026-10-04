# 📚 Documentation

This is the user-facing documentation for Twext. Start with the tutorial if you haven't built an extension yet, then use the rest as reference.

## 📕 Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [🧑‍💻 Learning](#-learning)
- [📖 Reference](#-reference)
- [🛜 TwextHub](#-twexthub)
- [🧑‍💻 Working on Twext](#-working-on-twext)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## 🧑‍💻 Learning

- [Build Your Extension](./build-your-extension.md): write a `twext.yml` and a handler by hand, then add arguments, menus, and shared state.
- [Writing Blocks](./writing-blocks.md): how the entry point, the handlers, and `setup` end up in the compiled file.

## 📖 Reference

- [Twext Configuration](./configuration.md): every field in `twext.yml`, with the block types and argument types.
- [CLI Reference](./cli.md): every command and option, what the flags do, and how credentials are resolved.
- [Validation](./validation.md): what `twext validate` checks, including the free-variable analysis.
- [Editor Setup](./editor-setup.md): schema support for `twext.yml` and types for the entry point.

## 🛜 TwextHub

- [Using TwextHub](./twexthub.md): accounts, publishing, finding and checking out extensions, and publishing from CI.

## 🧑‍💻 Working on Twext

- [Developing Twext](./development.md): the layout of the repository, the tests, and how releases are cut.
