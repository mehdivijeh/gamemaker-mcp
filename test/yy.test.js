// Unit tests for the tolerant .yy JSON reader/writer.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTrailingCommas, parseYY, readYY, writeYY, toYYText } from "../src/yy.js";

test("stripTrailingCommas removes trailing commas", () => {
  assert.equal(stripTrailingCommas('{"a":1,}'), '{"a":1}');
  assert.equal(stripTrailingCommas("[1,2,]"), "[1,2]");
  assert.equal(stripTrailingCommas('{"a":[1,2,],"b":{"c":3,},}'), '{"a":[1,2],"b":{"c":3}}');
});

test("stripTrailingCommas preserves commas inside strings", () => {
  assert.equal(stripTrailingCommas('{"a":",}"}'), '{"a":",}"}');
  assert.equal(stripTrailingCommas('{"a":"x," ,}'), '{"a":"x," }');
  assert.equal(stripTrailingCommas('{"a":"esc\\",}"}'), '{"a":"esc\\",}"}');
});

test("stripTrailingCommas handles whitespace before closing brackets", () => {
  const text = '{\n  "a": 1,\n  "b": [1, 2, ],\n}';
  assert.deepEqual(JSON.parse(stripTrailingCommas(text)), { a: 1, b: [1, 2] });
});

test("parseYY parses relaxed GameMaker JSON", () => {
  const text = '{"$GMProject":"","%Name":"demo","resources":[{"id":{"name":"obj_x","path":"objects/obj_x/obj_x.yy",},},],}';
  const parsed = parseYY(text);
  assert.equal(parsed.name ?? parsed["%Name"], "demo");
  assert.equal(parsed.resources[0].id.name, "obj_x");
});

test("writeYY round-trips through readYY", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-mcp-yy-"));
  const file = path.join(dir, "thing.yy");
  const value = { name: "thing", nested: { list: [1, 2, 3] }, flag: true };
  writeYY(file, value);
  assert.deepEqual(readYY(file), value);
  assert.ok(toYYText(value).endsWith("\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});
