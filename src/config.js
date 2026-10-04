import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export function loadProduct() {
  const productPath = fileURLToPath(new URL("../product.yml", import.meta.url));
  return parse(readFileSync(productPath, "utf8")) ?? {};
}
