// Integration-ish tests for the project model + creators using a generated
// fixture project (no GameMaker install needed).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GMProject } from "../src/project.js";
import {
  createScript,
  createObject,
  createRoom,
  addRoomInstance,
  listRoomInstances,
  removeRoomInstance,
  setObjectEvent,
  listObjectEvents,
  readObjectEvent,
  setRoomCreationCode,
} from "../src/creators.js";
import { makeFixtureProject, cleanupFixture } from "./helpers/make-fixture.js";

test("fixture project loads with expected resources", () => {
  const { dir, yypPath, project } = makeFixtureProject("unit");
  try {
    const p = new GMProject(yypPath);
    const names = p.listResources().map((r) => `${r.type}:${r.name}`);
    assert.ok(names.includes("GMRoom:rm_main"));
    assert.ok(names.includes("GMObject:obj_player"));
    assert.ok(names.includes("GMScript:scr_helpers"));
    assert.deepEqual(p.roomOrder(), ["rm_main"]);
    assert.equal(p.firstRoom(), "rm_main");
    const summary = p.summary();
    assert.equal(summary.counts.GMObject, 1);
  } finally {
    cleanupFixture(dir);
  }
});

test("object events round-trip and appear in listObjectEvents", () => {
  const { dir, yypPath } = makeFixtureProject("events");
  try {
    const p = new GMProject(yypPath);
    setObjectEvent(p, "obj_player", "Create", "hp = 100;\n");
    const ev = setObjectEvent(p, "obj_player", "Async - Networking", "// net\n");
    assert.equal(ev.fileName, "Other_68.gml");
    assert.equal(readObjectEvent(p, "obj_player", "Create"), "hp = 100;\n");
    const events = listObjectEvents(p, "obj_player");
    const names = events.map((e) => e.name);
    assert.ok(names.includes("Create"));
    assert.ok(names.includes("Async - Networking"));
    const file68 = path.join(p.resourceDir("obj_player"), "Other_68.gml");
    assert.ok(fs.existsSync(file68));
  } finally {
    cleanupFixture(dir);
  }
});

test("room instances can be added, listed and removed", () => {
  const { dir, yypPath } = makeFixtureProject("rooms");
  try {
    const p = new GMProject(yypPath);
    const before = listRoomInstances(p, "rm_main");
    assert.equal(before.length, 1);
    const name = addRoomInstance(p, "rm_main", "obj_player", 240, 120, {});
    const after = listRoomInstances(p, "rm_main");
    assert.equal(after.length, 2);
    assert.ok(after.some((i) => i.name === name && i.x === 240));
    assert.equal(removeRoomInstance(p, "rm_main", name), true);
    assert.equal(listRoomInstances(p, "rm_main").length, 1);
  } finally {
    cleanupFixture(dir);
  }
});

test("room creation code file is written and cleared", () => {
  const { dir, yypPath } = makeFixtureProject("creationcode");
  try {
    const p = new GMProject(yypPath);
    const rel = setRoomCreationCode(p, "rm_main", "global.start = 1;\n");
    assert.equal(rel, "rooms/rm_main/RoomCreationCode.gml");
    assert.equal(fs.readFileSync(p.abs(rel), "utf8"), "global.start = 1;\n");
    const yy = JSON.parse(
      fs.readFileSync(p.resourceYY("rm_main"), "utf8").replace(/,\s*([}\]])/g, "$1"),
    );
    assert.equal(yy.creationCodeFile, rel);
    setRoomCreationCode(p, "rm_main", "");
    assert.ok(!fs.existsSync(path.join(p.root, rel)));
  } finally {
    cleanupFixture(dir);
  }
});

test("createRoom/addResource rejects duplicates", () => {
  const { dir, yypPath } = makeFixtureProject("dup");
  try {
    const p = new GMProject(yypPath);
    assert.throws(() => createRoom(p, "rm_main"), /already exists/);
    assert.throws(() => createObject(p, "obj_player"), /already exists/);
    assert.throws(() => createScript(p, "scr_helpers"), /already exists/);
  } finally {
    cleanupFixture(dir);
  }
});
