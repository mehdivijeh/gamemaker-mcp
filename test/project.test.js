// Integration-ish tests for the project model + creators using a generated
// fixture project (no GameMaker install needed).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GMProject } from "../src/project.js";
import { readYY } from "../src/yy.js";
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
  getObject,
  updateObject,
  getRoom,
  updateRoom,
  setFirstRoom,
  createProject,
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
    const yy = readYY(p.resourceYY("rm_main"));
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

test("getObject and updateObject inspect and modify object properties", () => {
  const { dir, yypPath } = makeFixtureProject("obj-props");
  try {
    const p = new GMProject(yypPath);
    const initial = getObject(p, "obj_player");
    assert.equal(initial.name, "obj_player");
    assert.equal(initial.sprite, null);
    assert.equal(initial.visible, true);

    const updated = updateObject(p, "obj_player", {
      visible: false,
      solid: true,
      persistent: true,
    });
    assert.equal(updated.visible, false);
    assert.equal(updated.solid, true);
    assert.equal(updated.persistent, true);

    const reloaded = getObject(p, "obj_player");
    assert.equal(reloaded.visible, false);
    assert.equal(reloaded.solid, true);
    assert.equal(reloaded.persistent, true);
  } finally {
    cleanupFixture(dir);
  }
});

test("getRoom and updateRoom inspect and modify room settings", () => {
  const { dir, yypPath } = makeFixtureProject("room-props");
  try {
    const p = new GMProject(yypPath);
    const initial = getRoom(p, "rm_main");
    assert.equal(initial.name, "rm_main");
    assert.equal(initial.width, 640);
    assert.equal(initial.height, 480);
    assert.equal(initial.instanceCount, 1);

    const updated = updateRoom(p, "rm_main", { width: 1920, height: 1080, persistent: true });
    assert.equal(updated.width, 1920);
    assert.equal(updated.height, 1080);
    assert.equal(updated.persistent, true);

    const reloaded = getRoom(p, "rm_main");
    assert.equal(reloaded.width, 1920);
    assert.equal(reloaded.height, 1080);
    assert.equal(reloaded.persistent, true);
  } finally {
    cleanupFixture(dir);
  }
});

test("setFirstRoom reorders rooms in project", () => {
  const { dir, yypPath } = makeFixtureProject("first-room");
  try {
    const p = new GMProject(yypPath);
    createRoom(p, "rm_second", { width: 800, height: 600 });
    assert.deepEqual(p.roomOrder(), ["rm_main", "rm_second"]);

    const order = setFirstRoom(p, "rm_second");
    assert.deepEqual(order, ["rm_second", "rm_main"]);
    assert.equal(p.firstRoom(), "rm_second");
  } finally {
    cleanupFixture(dir);
  }
});

test("createProject bootstraps a valid project with standard folders and starting room", () => {
  const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "gm-new-proj-"));
  try {
    const { project, yypPath, name } = createProject(path.join(tmpDir, "NewGame"), "NewGame", {
      width: 1280,
      height: 720,
      firstRoom: "rm_start",
    });
    assert.equal(name, "NewGame");
    assert.ok(fs.existsSync(yypPath));
    assert.deepEqual(project.roomOrder(), ["rm_start"]);
    const summary = project.summary();
    assert.equal(summary.name, "NewGame");
    assert.equal(summary.counts.GMRoom, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
