// Resource creators: scripts, objects (+events), rooms (+instances),
// sprites and the MCP runtime bridge. Every function takes an open GMProject
// and persists its changes (writes the .yy/.gml files and saves the .yyp).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveEvent, eventName } from "./events.js";
import { readYY, writeYY, writeText } from "./yy.js";
import { GMProject, TYPE_DIRS, folderForType } from "./project.js";

export function folderRef(type) {
  return { name: folderForType(type), path: `folders/${folderForType(type)}.yy` };
}

export function relYY(type, name) {
  return `${TYPE_DIRS[type]}/${name}/${name}.yy`;
}

/* ------------------------------------------------------------------ */
/* Scripts                                                             */
/* ------------------------------------------------------------------ */

export function createScript(project, name, content = "") {
  if (project.findResource(name)) throw new Error(`Resource "${name}" already exists.`);
  const rel = relYY("GMScript", name);
  writeText(project.abs(`scripts/${name}/${name}.gml`), content);
  writeYY(project.abs(rel), {
    $GMScript: "",
    "%Name": name,
    isCompatibility: false,
    isDnD: false,
    name,
    parent: folderRef("GMScript"),
    resourceType: "GMScript",
    resourceVersion: "2.0",
  });
  project.addResource(name, "GMScript", rel);
  project.save();
  return rel;
}

export function updateScript(project, name, content) {
  const r = project.findResource(name);
  if (!r || r.type !== "GMScript") throw new Error(`Script "${name}" not found.`);
  writeText(project.abs(`scripts/${name}/${name}.gml`), content);
}

export function readScript(project, name) {
  const r = project.findResource(name);
  if (!r || r.type !== "GMScript") throw new Error(`Script "${name}" not found.`);
  return project.readText(`scripts/${name}/${name}.gml`);
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

export function findObjectYY(project, objectName) {
  const r = project.findResource(objectName);
  if (!r || r.type !== "GMObject") throw new Error(`Object "${objectName}" not found.`);
  return { yyPath: project.resourceYY(objectName), type: r.type };
}

export function createObject(project, name, opts = {}) {
  if (project.findResource(name)) throw new Error(`Resource "${name}" already exists.`);
  const rel = relYY("GMObject", name);
  const yy = {
    $GMObject: "",
    "%Name": name,
    eventList: opts.events ?? [],
    managed: true,
    name,
    overriddenProperties: [],
    parent: opts.parentFolder ?? folderRef("GMObject"),
    parentObjectId: opts.parentObject
      ? { name: opts.parentObject, path: relYY("GMObject", opts.parentObject) }
      : null,
    persistent: !!opts.persistent,
    physicsAngularDamping: 0.1,
    physicsDensity: 0.5,
    physicsFriction: 0.2,
    physicsGroup: 1,
    physicsKinematic: false,
    physicsLinearDamping: 0.1,
    physicsObject: false,
    physicsRestitution: 0.1,
    physicsSensor: false,
    physicsShape: 1,
    physicsShapePoints: [],
    physicsStartAwake: true,
    properties: [],
    resourceType: "GMObject",
    resourceVersion: "2.0",
    solid: !!opts.solid,
    spriteId: opts.sprite ? { name: opts.sprite, path: relYY("GMSprite", opts.sprite) } : null,
    spriteMaskId: null,
    visible: opts.visible !== false,
  };
  writeYY(project.abs(rel), yy);
  project.addResource(name, "GMObject", rel);
  project.save();
  return rel;
}

export function updateObject(project, objectName, opts = {}) {
  const { yyPath } = findObjectYY(project, objectName);
  const yy = readYY(yyPath);
  if (opts.sprite !== undefined) {
    yy.spriteId = opts.sprite
      ? { name: opts.sprite, path: relYY("GMSprite", opts.sprite) }
      : null;
  }
  if (opts.parentObject !== undefined) {
    yy.parentObjectId = opts.parentObject
      ? { name: opts.parentObject, path: relYY("GMObject", opts.parentObject) }
      : null;
  }
  if (opts.visible !== undefined) yy.visible = !!opts.visible;
  if (opts.solid !== undefined) yy.solid = !!opts.solid;
  if (opts.persistent !== undefined) yy.persistent = !!opts.persistent;
  writeYY(yyPath, yy);
  return {
    name: objectName,
    sprite: yy.spriteId?.name ?? null,
    parentObject: yy.parentObjectId?.name ?? null,
    visible: yy.visible,
    solid: yy.solid,
    persistent: yy.persistent,
  };
}

export function getObject(project, objectName) {
  const { yyPath } = findObjectYY(project, objectName);
  const yy = readYY(yyPath);
  return {
    name: objectName,
    sprite: yy.spriteId?.name ?? null,
    parentObject: yy.parentObjectId?.name ?? null,
    visible: yy.visible,
    solid: yy.solid,
    persistent: yy.persistent,
    events: listObjectEvents(project, objectName),
  };
}

export function setObjectEvent(project, objectName, spec, code) {
  const { yyPath } = findObjectYY(project, objectName);
  const yy = readYY(yyPath);
  const ev = resolveEvent(spec);
  yy.eventList ??= [];
  if (!yy.eventList.some((e) => e.eventType === ev.eventType && e.eventNum === ev.eventNum)) {
    yy.eventList.push({
      $GMEvent: "v1",
      "%Name": "",
      collisionObjectId: null,
      eventNum: ev.eventNum,
      eventType: ev.eventType,
      isDnD: false,
      name: "",
      resourceType: "GMEvent",
      resourceVersion: "2.0",
    });
  }
  writeYY(yyPath, yy);
  writeText(path.join(path.dirname(yyPath), ev.fileName), code);
  return ev;
}

export function readObjectEvent(project, objectName, spec) {
  const { yyPath } = findObjectYY(project, objectName);
  const ev = resolveEvent(spec);
  const file = path.join(path.dirname(yyPath), ev.fileName);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export function removeObjectEvent(project, objectName, spec) {
  const { yyPath } = findObjectYY(project, objectName);
  const yy = readYY(yyPath);
  const ev = resolveEvent(spec);
  yy.eventList = (yy.eventList ?? []).filter(
    (e) => !(e.eventType === ev.eventType && e.eventNum === ev.eventNum),
  );
  writeYY(yyPath, yy);
  fs.rmSync(path.join(path.dirname(yyPath), ev.fileName), { force: true });
  return ev;
}

const EVENT_PREFIXES = {
  0: "Create", 1: "Destroy", 2: "Alarm", 3: "Step", 4: "Collision", 5: "Keyboard",
  6: "Mouse", 7: "Other", 8: "Draw", 9: "KeyPress", 10: "KeyRelease", 11: "Trigger",
  12: "CleanUp", 13: "Gesture", 14: "PreCreate",
};

export function listObjectEvents(project, objectName) {
  const { yyPath } = findObjectYY(project, objectName);
  const yy = readYY(yyPath);
  const dir = path.dirname(yyPath);
  return (yy.eventList ?? []).map((e) => {
    const file = `${EVENT_PREFIXES[e.eventType] ?? "Event"}_${e.eventNum}.gml`;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(dir, file)).size;
    } catch {
      /* missing file */
    }
    return {
      name: eventName(e.eventType, e.eventNum),
      eventType: e.eventType,
      eventNum: e.eventNum,
      fileName: file,
      hasCode: bytes > 0,
      codeBytes: bytes,
    };
  });
}

export function randomInstanceName() {
  return `inst_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/* ------------------------------------------------------------------ */
/* MCP runtime bridge                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ensure the MCP bridge exists in the project:
 *  - script "mcp_bridge" (functions + config)
 *  - object "obj_mcp_bridge" (persistent, invisible) with Create / Step /
 *    Async Networking / Clean Up events
 *  - one instance of it in the first room (so it starts with the game)
 *
 * Idempotent: refreshes content when already present.
 * @param {import("./project.js").GMProject} project
 * @param {{gmlDir: string, port?: number}} opts
 */
export function injectBridge(project, opts) {
  const { gmlDir, port = 18253 } = opts;
  const read = (f) => fs.readFileSync(path.join(gmlDir, f), "utf8");
  const config = read("mcp_bridge.gml").replace(/__MCP_PORT__/g, String(port));

  if (project.findResource("mcp_bridge")) {
    updateScript(project, "mcp_bridge", config);
  } else {
    createScript(project, "mcp_bridge", config);
  }

  const objectName = "obj_mcp_bridge";
  if (!project.findResource(objectName)) {
    createObject(project, objectName, { persistent: true, visible: false });
  }
  setObjectEvent(project, objectName, "Create", read("events/create.gml"));
  setObjectEvent(project, objectName, "Step", read("events/step.gml"));
  setObjectEvent(project, objectName, "Async - Networking", read("events/async_networking.gml"));
  setObjectEvent(project, objectName, "Clean Up", read("events/cleanup.gml"));

  const firstRoom = project.firstRoom();
  let instancePlaced = false;
  if (firstRoom) {
    const existing = listRoomInstances(project, firstRoom);
    if (existing.some((i) => i.object === objectName)) {
      instancePlaced = true;
    } else {
      addRoomInstance(project, firstRoom, objectName, 0, 0, { instanceName: "inst_mcp_bridge" });
      instancePlaced = true;
    }
  }
  return { script: "mcp_bridge", object: objectName, firstRoom, instancePlaced, port };
}

/* ------------------------------------------------------------------ */
/* Rooms + instances                                                   */
/* ------------------------------------------------------------------ */

function viewTemplate(w, h) {
  return {
    hborder: 32, hport: h, hspeed: -1, hview: h, inherit: false, objectId: null,
    vborder: 32, visible: false, vspeed: -1, wport: w, wview: w, xport: 0,
    xview: 0, yport: 0, yview: 0,
  };
}

export function roomYY(name, w, h, opts = {}) {
  const view = viewTemplate(w, h);
  return {
    $GMRoom: "v1",
    "%Name": name,
    creationCodeFile: "",
    inheritCode: false,
    inheritCreationOrder: false,
    inheritLayers: false,
    instanceCreationOrder: [],
    isDnd: false,
    layers: [
      {
        $GMRInstanceLayer: "", "%Name": "Instances", depth: 0, effectEnabled: true,
        effectType: null, gridX: 32, gridY: 32, hierarchyFrozen: false,
        inheritLayerDepth: false, inheritLayerSettings: false, inheritSubLayers: true,
        inheritVisibility: true, instances: [], layers: [], name: "Instances",
        properties: [], resourceType: "GMRInstanceLayer", resourceVersion: "2.0",
        userdefinedDepth: false, visible: true,
      },
      {
        $GMRBackgroundLayer: "", "%Name": "Background", animationFPS: 15.0,
        animationSpeedType: 0, colour: 4278190080, depth: 100, effectEnabled: true,
        effectType: null, gridX: 32, gridY: 32, hierarchyFrozen: false, hspeed: 0.0,
        htiled: false, inheritLayerDepth: false, inheritLayerSettings: false,
        inheritSubLayers: true, inheritVisibility: true, layers: [], name: "Background",
        properties: [], resourceType: "GMRBackgroundLayer", resourceVersion: "2.0",
        spriteId: null, stretch: false, userdefinedAnimFPS: false, userdefinedDepth: false,
        visible: true, vspeed: 0.0, vtiled: false, x: 0, y: 0,
      },
    ],
    name,
    parent: folderRef("GMRoom"),
    parentRoom: opts.parentRoom ? { name: opts.parentRoom, path: relYY("GMRoom", opts.parentRoom) } : null,
    physicsSettings: {
      inheritPhysicsSettings: false, PhysicsWorld: false, PhysicsWorldGravityX: 0.0,
      PhysicsWorldGravityY: 10.0, PhysicsWorldPixToMetres: 0.1,
    },
    resourceType: "GMRoom",
    resourceVersion: "2.0",
    roomSettings: { Height: h, inheritRoomSettings: false, persistent: !!opts.persistent, Width: w },
    sequenceId: null,
    views: [view, view, view, view, view, view, view, view],
    viewSettings: { clearDisplayBuffer: true, clearViewBackground: false, enableViews: false, inheritViewSettings: false },
    volume: 1.0,
  };
}

export function createRoom(project, name, opts = {}) {
  if (project.findResource(name)) throw new Error(`Resource "${name}" already exists.`);
  const rel = relYY("GMRoom", name);
  writeYY(project.abs(rel), roomYY(name, opts.width ?? 1366, opts.height ?? 768, opts));
  project.addResource(name, "GMRoom", rel);
  project.data.RoomOrderNodes ??= [];
  if (opts.first) {
    project.data.RoomOrderNodes.unshift({ roomId: { name, path: rel } });
  } else {
    project.data.RoomOrderNodes.push({ roomId: { name, path: rel } });
  }
  project.save();
  return rel;
}

export function listRoomInstances(project, roomName) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const yy = readYY(project.resourceYY(roomName));
  const out = [];
  for (const layer of yy.layers ?? []) {
    if (layer.resourceType !== "GMRInstanceLayer") continue;
    for (const inst of layer.instances ?? []) {
      out.push({
        name: inst.name,
        object: inst.objectId?.name ?? "?",
        x: inst.x,
        y: inst.y,
        layer: layer.name,
        hasCreationCode: !!inst.hasCreationCode,
      });
    }
  }
  return out;
}

export function addRoomInstance(project, roomName, objectName, x, y, opts = {}) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const or = project.findResource(objectName);
  if (!or || or.type !== "GMObject") throw new Error(`Object "${objectName}" not found.`);
  const yyPath = project.resourceYY(roomName);
  const yy = readYY(yyPath);
  const layerName = opts.layer ?? "Instances";
  const layer = (yy.layers ?? []).find(
    (l) => l.resourceType === "GMRInstanceLayer" && l.name === layerName,
  );
  if (!layer) throw new Error(`Instance layer "${layerName}" not found in room "${roomName}".`);

  const instName = opts.instanceName ?? randomInstanceName();
  const inst = {
    $GMRInstance: "v1",
    "%Name": instName,
    colour: 4294967295,
    frozen: false,
    hasCreationCode: false,
    ignore: false,
    imageIndex: 0,
    imageSpeed: 1.0,
    inheritCode: false,
    inheritedItemId: null,
    inheritItemSettings: false,
    isDnd: false,
    name: instName,
    objectId: { name: objectName, path: relYY("GMObject", objectName) },
    properties: [],
    resourceType: "GMRInstance",
    resourceVersion: "2.0",
    rotation: opts.rotation ?? 0.0,
    scaleX: opts.scaleX ?? 1.0,
    scaleY: opts.scaleY ?? 1.0,
    x: x ?? 0.0,
    y: y ?? 0.0,
  };
  layer.instances ??= [];
  layer.instances.push(inst);
  yy.instanceCreationOrder ??= [];
  yy.instanceCreationOrder.push({ name: instName, path: r.path });

  if (opts.creationCode) {
    inst.hasCreationCode = true;
    writeText(
      path.join(path.dirname(yyPath), `InstanceCreationCode_${instName}.gml`),
      opts.creationCode,
    );
  }
  writeYY(yyPath, yy);
  return instName;
}

export function removeRoomInstance(project, roomName, instanceName) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const yyPath = project.resourceYY(roomName);
  const yy = readYY(yyPath);
  let removed = false;
  for (const layer of yy.layers ?? []) {
    if (layer.resourceType !== "GMRInstanceLayer") continue;
    const before = (layer.instances ?? []).length;
    layer.instances = (layer.instances ?? []).filter((i) => i.name !== instanceName);
    if (layer.instances.length !== before) removed = true;
  }
  yy.instanceCreationOrder = (yy.instanceCreationOrder ?? []).filter((i) => i.name !== instanceName);
  writeYY(yyPath, yy);
  fs.rmSync(path.join(path.dirname(yyPath), `InstanceCreationCode_${instanceName}.gml`), { force: true });
  return removed;
}

export function setRoomCreationCode(project, roomName, code) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const yyPath = project.resourceYY(roomName);
  const yy = readYY(yyPath);
  const rel = `${TYPE_DIRS.GMRoom}/${roomName}/RoomCreationCode.gml`;
  if (code && code.length > 0) {
    yy.creationCodeFile = rel;
    writeText(project.abs(rel), code);
  } else {
    yy.creationCodeFile = "";
    fs.rmSync(project.abs(rel), { force: true });
  }
  writeYY(yyPath, yy);
  return yy.creationCodeFile;
}

export function getRoom(project, roomName) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const yy = readYY(project.resourceYY(roomName));
  const instances = listRoomInstances(project, roomName);
  return {
    name: roomName,
    width: yy.roomSettings?.Width ?? 1366,
    height: yy.roomSettings?.Height ?? 768,
    persistent: !!yy.roomSettings?.persistent,
    creationCodeFile: yy.creationCodeFile || null,
    instanceCount: instances.length,
    instances,
    layers: (yy.layers ?? []).map((l) => ({
      name: l.name,
      type: l.resourceType,
      visible: l.visible,
      depth: l.depth,
    })),
  };
}

export function updateRoom(project, roomName, opts = {}) {
  const r = project.findResource(roomName);
  if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found.`);
  const yyPath = project.resourceYY(roomName);
  const yy = readYY(yyPath);
  yy.roomSettings ??= { Width: 1366, Height: 768, persistent: false, inheritRoomSettings: false };
  if (opts.width !== undefined) yy.roomSettings.Width = opts.width;
  if (opts.height !== undefined) yy.roomSettings.Height = opts.height;
  if (opts.persistent !== undefined) yy.roomSettings.persistent = !!opts.persistent;
  writeYY(yyPath, yy);
  return {
    name: roomName,
    width: yy.roomSettings.Width,
    height: yy.roomSettings.Height,
    persistent: yy.roomSettings.persistent,
  };
}

export function setFirstRoom(project, roomName) {
  return project.setFirstRoom(roomName);
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export function createProject(targetPath, name, opts = {}) {
  let projectDir;
  let yypPath;
  if (targetPath.endsWith(".yyp")) {
    yypPath = path.resolve(targetPath);
    projectDir = path.dirname(yypPath);
    name = name || path.basename(yypPath, ".yyp");
  } else {
    name = name || path.basename(targetPath);
    projectDir = path.resolve(targetPath);
    yypPath = path.join(projectDir, `${name}.yyp`);
  }

  if (fs.existsSync(yypPath)) {
    throw new Error(`Project already exists at ${yypPath}`);
  }
  fs.mkdirSync(projectDir, { recursive: true });

  const standardFolders = [
    "Objects",
    "Rooms",
    "Scripts",
    "Sprites",
    "Sounds",
    "Shaders",
    "Fonts",
    "Tile Sets",
    "Sequences",
    "Timelines",
    "Paths",
    "Extensions",
    "Notes",
    "Particle Systems",
  ];

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
    Folders: standardFolders.map((f) => ({
      $GMFolder: "",
      "%Name": f,
      folderPath: `folders/${f}.yy`,
      name: f,
      resourceType: "GMFolder",
      resourceVersion: "2.0",
    })),
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

  const firstRoomName = opts.firstRoom ?? "rm_game";
  if (firstRoomName) {
    createRoom(project, firstRoomName, {
      width: opts.width ?? 1366,
      height: opts.height ?? 768,
      first: true,
    });
  }

  return { project, yypPath, name };
}

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */

/** Read width/height from a PNG file header without decoding it. */
export function pngSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    if (head.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG file`);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Import one or more PNG frames as a new sprite resource (2024.x+ format:
 * per-frame GUID .png files + layers/<frame>/<layer>.png + sequence track).
 * @param {import("./project.js").GMProject} project
 * @param {string} name
 * @param {string[]} framePaths absolute PNG paths (playback order)
 * @param {{fps?: number, originX?: number, originY?: number}} opts
 */
export function importSprite(project, name, framePaths, opts = {}) {
  if (project.findResource(name)) throw new Error(`Resource "${name}" already exists.`);
  if (!framePaths || framePaths.length === 0) throw new Error("At least one PNG frame is required.");
  const dirRel = `sprites/${name}`;
  const yyRel = `${dirRel}/${name}.yy`;
  fs.mkdirSync(project.abs(dirRel), { recursive: true });

  const layerGuid = crypto.randomUUID();
  let width = 0;
  let height = 0;
  const frames = [];
  for (const p of framePaths) {
    const { width: w, height: h } = pngSize(p);
    width = Math.max(width, w);
    height = Math.max(height, h);
    const frameGuid = crypto.randomUUID();
    fs.copyFileSync(p, project.abs(`${dirRel}/${frameGuid}.png`));
    const layerDir = project.abs(`${dirRel}/layers/${frameGuid}`);
    fs.mkdirSync(layerDir, { recursive: true });
    fs.copyFileSync(p, path.join(layerDir, `${layerGuid}.png`));
    frames.push({ guid: frameGuid, w, h });
  }

  const originX = opts.originX ?? Math.floor(width / 2);
  const originY = opts.originY ?? Math.floor(height / 2);
  const fps = opts.fps ?? 30;

  const yy = {
    $GMSprite: "",
    "%Name": name,
    bboxMode: 0,
    bbox_bottom: height - 1,
    bbox_left: 0,
    bbox_right: width - 1,
    bbox_top: 0,
    collisionKind: 1,
    collisionTolerance: 0,
    DynamicTexturePage: false,
    edgeFiltering: false,
    For3D: false,
    frames: frames.map((f) => ({
      $GMSpriteFrame: "",
      "%Name": f.guid,
      name: f.guid,
      resourceType: "GMSpriteFrame",
      resourceVersion: "2.0",
    })),
    gridX: 0,
    gridY: 0,
    height,
    HTile: false,
    layers: [
      {
        $GMImageLayer: "",
        "%Name": layerGuid,
        blendMode: 0,
        displayName: "default",
        isLocked: false,
        name: layerGuid,
        opacity: 100.0,
        resourceType: "GMImageLayer",
        resourceVersion: "2.0",
        visible: true,
      },
    ],
    name,
    nineSlice: null,
    origin: 9,
    parent: folderRef("GMSprite"),
    preMultiplyAlpha: false,
    resourceType: "GMSprite",
    resourceVersion: "2.0",
    sequence: spriteSequence(name, yyRel, frames, fps, width, height, originX, originY),
    swatchColours: null,
    swfPrecision: 2.525,
    textureGroupId: { name: "Default", path: "texturegroups/Default" },
    type: 0,
    VTile: false,
    width,
  };
  writeYY(project.abs(yyRel), yy);
  project.addResource(name, "GMSprite", yyRel);
  project.save();
  return { path: yyRel, frames: frames.length, width, height, originX, originY };
}

function spriteSequence(name, yyRel, frames, fps, width, height, originX, originY) {
  return {
    $GMSequence: "",
    "%Name": name,
    autoRecord: true,
    backdropHeight: height,
    backdropImageOpacity: 0.5,
    backdropImagePath: "",
    backdropWidth: width,
    backdropXOffset: 0.0,
    backdropYOffset: 0.0,
    events: {
      "$KeyframeStore<MessageEventKeyframe>": "",
      Keyframes: [],
      resourceType: "KeyframeStore<MessageEventKeyframe>",
      resourceVersion: "2.0",
    },
    eventStubScript: null,
    eventToFunction: {},
    length: frames.length,
    lockOrigin: false,
    moments: {
      "$KeyframeStore<MomentsEventKeyframe>": "",
      Keyframes: [],
      resourceType: "KeyframeStore<MomentsEventKeyframe>",
      resourceVersion: "2.0",
    },
    name,
    playback: 1,
    playbackSpeed: fps,
    playbackSpeedType: 0,
    resourceType: "GMSequence",
    resourceVersion: "2.0",
    showBackdrop: true,
    showBackdropImage: false,
    timeUnits: 1,
    tracks: [
      {
        $GMSpriteFramesTrack: "",
        builtinName: 0,
        events: [],
        inheritsTrackColour: true,
        interpolation: 1,
        isCreationTrack: false,
        keyframes: {
          "$KeyframeStore<SpriteFrameKeyframe>": "",
          Keyframes: frames.map((f, i) => ({
            "$Keyframe<SpriteFrameKeyframe>": "",
            Channels: {
              "0": {
                $SpriteFrameKeyframe: "",
                Id: { name: f.guid, path: yyRel },
                resourceType: "SpriteFrameKeyframe",
                resourceVersion: "2.0",
              },
            },
            Disabled: false,
            id: crypto.randomUUID(),
            IsCreationKey: false,
            Key: i,
            Length: i + 1,
            resourceType: "Keyframe<SpriteFrameKeyframe>",
            resourceVersion: "2.0",
            Stretch: false,
          })),
          resourceType: "KeyframeStore<SpriteFrameKeyframe>",
          resourceVersion: "2.0",
        },
        modifiers: [],
        name: "frames",
        resourceType: "GMSpriteFramesTrack",
        resourceVersion: "2.0",
        spriteId: null,
        trackColour: 0,
        tracks: [],
        traits: 0,
      },
    ],
    visibleRange: null,
    volume: 1.0,
    xorigin: originX,
    yorigin: originY,
  };
}


