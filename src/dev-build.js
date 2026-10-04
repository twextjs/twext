#!/usr/bin/env node
// A build worker for the dev server: the CLI entry point imports every command,
// but a rebuild only needs the compiler, so a child that loads just those starts
// faster and keeps a save-to-extension loop short.
import { loadProduct } from "./config.js";
import { createLogger } from "./log.js";
import { buildCommand } from "./commands/build.js";

const [, , configPath, output] = process.argv;
const product = loadProduct();
const log = createLogger(product);
process.exitCode = (await buildCommand(product, configPath, output, log)) ? 0 : 1;
