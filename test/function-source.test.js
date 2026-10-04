import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFunctionSource } from "../src/function-source.js";

test("named function declaration", () => {
  const parsed = parseFunctionSource(`function doLogWork(args, util) {
  console.log(prefix, args.MESSAGE);
}`);
  assert.equal(parsed.async, false);
  assert.equal(parsed.params, "args, util");
  assert.match(parsed.body, /console\.log/);
});

test("anonymous function expression", () => {
  const parsed = parseFunctionSource(`function (a = 1) {
  return a;
}`);
  assert.equal(parsed.async, false);
  assert.equal(parsed.params, "a = 1");
});

test("async function", () => {
  const parsed = parseFunctionSource(`async function fetchX() {
  return 1;
}`);
  assert.equal(parsed.async, true);
  assert.equal(parsed.params, "");
});

test("arrow with block body", () => {
  const parsed = parseFunctionSource(`(a, b) => {
  return a + b;
}`);
  assert.equal(parsed.async, false);
  assert.equal(parsed.params, "a, b");
  assert.equal(parsed.expressionBody, false);
});

test("arrow with expression body", () => {
  const parsed = parseFunctionSource(`(a) => a * 2`);
  assert.equal(parsed.params, "a");
  assert.equal(parsed.expressionBody, true);
  assert.equal(parsed.body, "a * 2");
});

test("async arrow", () => {
  const parsed = parseFunctionSource(`async (x) => {
  return await x;
}`);
  assert.equal(parsed.async, true);
  assert.equal(parsed.params, "x");
});

test("bare single-parameter arrow", () => {
  const parsed = parseFunctionSource(`x => x + 1`);
  assert.equal(parsed.params, "x");
  assert.equal(parsed.expressionBody, true);
  assert.equal(parsed.body, "x + 1");
});

test("bare single-parameter arrow with block body", () => {
  const parsed = parseFunctionSource(`value => {
  return value * 2;
}`);
  assert.equal(parsed.async, false);
  assert.equal(parsed.params, "value");
  assert.equal(parsed.expressionBody, false);
  assert.match(parsed.body, /return value \* 2;/);
});

test("params with default object braces", () => {
  const parsed = parseFunctionSource(`function f({ VALUE }, util = {}) {
  return VALUE;
}`);
  assert.equal(parsed.params, "{ VALUE }, util = {}");
});

test("returns null for non-function source", () => {
  assert.equal(parseFunctionSource("const x = 1"), null);
});

test("rejects generator declarations", () => {
  assert.equal(
    parseFunctionSource(`function* gen() {
  yield 1;
}`),
    null,
  );
});
