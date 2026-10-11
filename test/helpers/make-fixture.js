// Creates a minimal but valid GameMaker project in a temp dir for tests.
// Uses the real creators module so tests exercise the same code paths that
// run against user projects.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeYY } from "../../src/yy.js";
import { createScript, createObject, createRoom, addRoomInstance } from "../../src/creators.js";
import { GMProject } from "../../src/project.js";

export function makeFixtureProject(name = "fixture") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-mcp-test-"));
  const yypPath = path.join(dir, `${name}.yyp`);

  const yyp = {
    $GMProject: "",
    "%Name": name,
    AudioGroups: [
      {
        $GMAudioGroup: "",
        "%Name": "audiogroup_default",
        name: "audiogroup_default",
        resourceType: "GMAudioGroup",
        resourceVersion: "2.0",
        targets: -1,
      },
    ],
    configs: { children: [], name: "Default" },
    defaultScriptType: 1,
    Folders: [
      { $GMFolder: "", "%Name": "Objects", folderPath: "folders/Objects.yy", name: "Objects", resourceType: "GMFolder", resourceVersion: "2.0" },
      { $GMFolder: "", "%Name": "Rooms", folderPath: "folders/Rooms.yy", name: "Rooms", resourceType: "GMFolder", resourceVersion: "2.0" },
      { $GMFolder: "", "%Name": "Scripts", folderPath: "folders/Scripts.yy", name: "Scripts", resourceType: "GMFolder", resourceVersion: "2.0" },
    ],
    IncludedFiles: [],
    isEcma: false,
    LibraryEmitters: [],
    MetaData: { IDEVersion: "2026.0.0.16" },
    name,
    resources: [],
    resourceType: "GMProject",
    resourceVersion: "2.0",
    RoomOrderNodes: [],
    templateType: null,
    TextureGroups: [
      {
        $GMTextureGroup: "",
        "%Name": "Default",
        autocrop: true,
        border: 2,
        compressFormat: "bz2",
        customOptions: "",
        directory: "",
        groupParent: null,
        isScaled: true,
        loadType: "default",
        mipsToGenerate: 0,
        name: "Default",
        resourceType: "GMTextureGroup",
        resourceVersion: "2.0",
        targets: -1,
      },
    ],
  };
  writeYY(yypPath, yyp);

  const project = new GMProject(yypPath);
  createRoom(project, "rm_main", { width: 640, height: 480, first: true });
  createObject(project, "obj_player", { visible: true });
  createScript(project, "scr_helpers", "/// helper\nfunction double(_n) {\n    return _n * 2;\n}\n");
  addRoomInstance(project, "rm_main", "obj_player", 100, 100, { instanceName: "inst_PLAYER01" });

  return { dir, yypPath, project };
}

export function cleanupFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
