// Unit tests for event name <-> (eventType, eventNum) resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEvent, eventName } from "../src/events.js";

test("basic events", () => {
  assert.deepEqual(resolveEvent("Create"), { eventType: 0, eventNum: 0, canonicalName: "Create", fileName: "Create_0.gml" });
  assert.deepEqual(resolveEvent("Step").fileName, "Step_0.gml");
  assert.deepEqual(resolveEvent("Begin Step").fileName, "Step_1.gml");
  assert.deepEqual(resolveEvent("End Step").fileName, "Step_2.gml");
  assert.deepEqual(resolveEvent("Clean Up").fileName, "CleanUp_0.gml");
  assert.deepEqual(resolveEvent("Draw GUI").fileName, "Draw_64.gml");
  assert.deepEqual(resolveEvent("Draw").fileName, "Draw_0.gml");
  assert.deepEqual(resolveEvent("Room Start").fileName, "Other_4.gml");
});

test("alarm, user and view events", () => {
  assert.equal(resolveEvent("Alarm 3").fileName, "Alarm_3.gml");
  assert.equal(resolveEvent("Alarm:7").fileName, "Alarm_7.gml");
  assert.equal(resolveEvent("User 5").fileName, "Other_15.gml");
  assert.equal(resolveEvent("Outside View 2").fileName, "Other_42.gml");
  assert.equal(resolveEvent("Boundary View 0").fileName, "Other_50.gml");
});

test("async networking is event 68 (verified against the LTS 2026 manual)", () => {
  const ev = resolveEvent("Async - Networking");
  assert.equal(ev.eventType, 7);
  assert.equal(ev.eventNum, 68);
  assert.equal(ev.fileName, "Other_68.gml");
  assert.equal(resolveEvent("Async - HTTP").eventNum, 62);
  assert.equal(resolveEvent("Async - System").eventNum, 75);
  assert.equal(resolveEvent("Async - Save/Load").eventNum, 72);
  assert.equal(resolveEvent("Async - Audio Playback").eventNum, 74);
});

test("raw Type:Num and Type_Num forms", () => {
  assert.equal(resolveEvent("Other:68").eventNum, 68);
  assert.equal(resolveEvent("Draw_64").eventType, 8);
  assert.equal(resolveEvent("Other_4").eventNum, 4);
});

test("aliases", () => {
  assert.equal(resolveEvent("networking").eventNum, 68);
  assert.equal(resolveEvent("drawgui").eventNum, 64);
  assert.equal(resolveEvent("endstep").fileName, "Step_2.gml");
});

test("unknown names throw with guidance", () => {
  assert.throws(() => resolveEvent("Frobnicate"), /Unknown event/);
  assert.throws(() => resolveEvent("Alarm 12"), /out of range/);
});

test("reverse lookup names", () => {
  assert.equal(eventName(0, 0), "Create");
  assert.equal(eventName(7, 68), "Async - Networking");
  assert.equal(eventName(2, 5), "Alarm 5");
  assert.equal(eventName(7, 12), "User 2");
});
