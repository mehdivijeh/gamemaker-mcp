// Sprite import tests (PNG -> GMSprite resource, frame/layer/sequence layout).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GMProject } from "../src/project.js";
import { readYY } from "../src/yy.js";
import { importSprite, pngSize } from "../src/creators.js";
import { makeFixtureProject, cleanupFixture } from "./helpers/make-fixture.js";
import { makePng } from "./helpers/make-png.js";

test("pngSize reads PNG dimensions", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "gm-png-"));
  const png = makePng(path.join(dir, "a.png"), 17, 9);
  assert.deepEqual(pngSize(png), { width: 17, height: 9 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pngSize rejects non-PNG files", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "gm-png-"));
  const file = path.join(dir, "not.png");
  fs.writeFileSync(file, "hello");
  assert.throws(() => pngSize(file), /not a PNG/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("importSprite builds a valid sprite folder + .yy + registration", () => {
  const { dir, yypPath } = makeFixtureProject("sprite");
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "gm-png-"));
  try {
    const f1 = makePng(path.join(tmp, "f1.png"), 32, 24, [255, 0, 0]);
    const f2 = makePng(path.join(tmp, "f2.png"), 32, 24, [0, 255, 0]);
    const p = new GMProject(yypPath);
    const res = importSprite(p, "spr_hero", [f1, f2], { fps: 12 });
    assert.equal(res.frames, 2);
    assert.equal(res.width, 32);
    assert.equal(res.height, 24);

    const yy = readYY(p.resourceYY("spr_hero"));
    assert.equal(yy.frames.length, 2);
    assert.equal(yy.layers.length, 1);
    assert.equal(yy.sequence.length, 2);
    assert.equal(yy.sequence.playbackSpeed, 12);
    assert.equal(yy.sequence.tracks[0].keyframes.Keyframes.length, 2);
    assert.equal(yy.width, 32);

    // frame pngs + layer pngs exist on disk
    const spriteDir = p.resourceDir("spr_hero");
    for (const frame of yy.frames) {
      assert.ok(fs.existsSync(path.join(spriteDir, `${frame.name}.png`)));
      assert.ok(fs.existsSync(path.join(spriteDir, "layers", frame.name, `${yy.layers[0].name}.png`)));
    }

    // registered in the .yyp
    const reloaded = new GMProject(yypPath);
    const found = reloaded.findResource("spr_hero");
    assert.ok(found);
    assert.equal(found.type, "GMSprite");

    // duplicate rejection
    assert.throws(() => importSprite(p, "spr_hero", [f1]), /already exists/);
  } finally {
    cleanupFixture(dir);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
