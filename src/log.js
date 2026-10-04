import pc from "picocolors";

export function createLogger(product) {
  return {
    success: (message) => console.log(pc.green(`${product.symbols.success} ${message}`)),
    error: (message) => console.error(pc.red(`${product.symbols.error} ${message}`)),
    warn: (message) => console.warn(pc.yellow(`${product.symbols.progress} ${message}`)),
    progress: (message) => console.log(pc.dim(`${product.symbols.progress} ${message}`)),
    bullet: (message) => console.log(`  ${product.symbols.bullet} ${message}`),
    info: (message) => console.log(message),
    raw: (message) => console.log(message),
  };
}
