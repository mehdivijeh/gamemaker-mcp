// Read/write model of a GameMaker project (.yyp + resource .yy files).
//
// The project file lists every resource as { id: { name, path } } where the
// path is relative to the project root folder. Resources live in one folder
// per type (scripts/, objects/, rooms/, sprites/, ...) as
// <type>/<Name>/<Name>.yy plus content files.

import fs from "node:fs";
import path from "node:path";
import { readYY, writeYY, writeText } from "./yy.js";

/** Resource type id -> project subfolder. */
export const TYPE_DIRS = {
  GMScript: "scripts",
  GMObject: "objects",
  GMRoom: "rooms",
  GMSprite: "sprites",
  GMSound: "sounds",
  GMShader: "shaders",
  GMFont: "fonts",
  GMTileSet: "tilesets",
  GMSequence: "sequences",
  GMTimeline: "timelines",
  GMPath: "paths",
  GMExtension: "extensions",
  GMAnimCurve: "animationcurves",
  GMNotes: "notes",
  GMParticleSystem: "particles",
  GMFilter: "filters",
  GMFolder: "folders",
};

/** Project subfolder -> resource type id. */
export const DIR_TYPES = Object.fromEntries(
  Object.entries(TYPE_DIRS).map(([t, d]) => [d, t]),
);

/** Friendly type aliases for tool arguments. */
export const TYPE_ALIASES = {
  script: "GMScript",
  scripts: "GMScript",
  object: "GMObject",
  objects: "GMObject",
  room: "GMRoom",
  rooms: "GMRoom",
  sprite: "GMSprite",
  sprites: "GMSprite",
  sound: "GMSound",
  sounds: "GMSound",
  shader: "GMShader",
  shaders: "GMShader",
  font: "GMFont",
  fonts: "GMFont",
  tileset: "GMTileSet",
  tilesets: "GMTileSet",
  sequence: "GMSequence",
  sequences: "GMSequence",
  timeline: "GMTimeline",
  timelines: "GMTimeline",
  path: "GMPath",
  paths: "GMPath",
  extension: "GMExtension",
  extensions: "GMExtension",
  note: "GMNotes",
  notes: "GMNotes",
  particles: "GMParticleSystem",
};

export function normalizeType(type) {
  if (!type) return undefined;
  const t = String(type).trim();
  if (TYPE_DIRS[t]) return t;
  const alias = TYPE_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  throw new Error(`Unknown resource type "${type}".`);
}

export class GMProject {
  /** @param {string} yypPath absolute path to the .yyp file */
  constructor(yypPath) {
    this.yypPath = path.resolve(yypPath);
    this.root = path.dirname(this.yypPath);
    this.data = readYY(this.yypPath);
    if (this.data.resourceType !== "GMProject") {
      throw new Error(`${yypPath} is not a GameMaker project (resourceType=${this.data.resourceType})`);
    }
    this.name = this.data.name || path.basename(this.root);
  }

  get ideVersion() {
    return this.data.MetaData?.IDEVersion ?? "unknown";
  }

  save() {
    writeYY(this.yypPath, this.data);
  }

  abs(rel) {
    return path.join(this.root, rel);
  }

  /** All resources listed in the .yyp as { name, path, type }. */
  listResources(typeFilter) {
    const want = normalizeType(typeFilter);
    const out = [];
    for (const entry of this.data.resources ?? []) {
      const rel = entry.id.path;
      const dir = rel.split("/")[0];
      const type = DIR_TYPES[dir] ?? "Unknown";
      if (want && type !== want) continue;
      out.push({ name: entry.id.name, path: rel, type });
    }
    return out;
  }

  /** Find the .yyp resource entry (and its type) by name. */
  findResource(name) {
    const entry = (this.data.resources ?? []).find((r) => r.id.name === name);
    if (!entry) return undefined;
    const dir = entry.id.path.split("/")[0];
    return { name: entry.id.name, path: entry.id.path, type: DIR_TYPES[dir] ?? "Unknown", entry };
  }

  /** Absolute path of the .yy file for a resource. */
  resourceYY(name) {
    const r = this.findResource(name);
    if (!r) throw new Error(`Resource "${name}" not found in project.`);
    return this.abs(r.path);
  }

  /** Absolute path of the resource's folder. */
  resourceDir(name) {
    return path.dirname(this.resourceYY(name));
  }

  /** Rooms in RoomOrderNodes order (first room = game start). */
  roomOrder() {
    return (this.data.RoomOrderNodes ?? []).map((n) => n.roomId.name);
  }

  firstRoom() {
    return this.roomOrder()[0];
  }

  /** Type distribution summary. */
  summary() {
    const counts = {};
    for (const r of this.listResources()) {
      counts[r.type] = (counts[r.type] ?? 0) + 1;
    }
    return {
      name: this.name,
      yypPath: this.yypPath,
      ideVersion: this.ideVersion,
      resourceVersion: this.data.resourceVersion,
      counts,
      roomOrder: this.roomOrder(),
    };
  }

  /** Make sure the standard folder node exists in the .yyp Folders list. */
  ensureFolder(folderName) {
    this.data.Folders ??= [];
    if (!this.data.Folders.some((f) => f.name === folderName)) {
      this.data.Folders.push({
        $GMFolder: "",
        "%Name": folderName,
        folderPath: `folders/${folderName}.yy`,
        name: folderName,
        resourceType: "GMFolder",
        resourceVersion: "2.0",
      });
    }
  }

  /** Register a new resource in the .yyp. */
  addResource(name, type, relPath) {
    if (this.findResource(name)) {
      throw new Error(`Resource "${name}" already exists.`);
    }
    this.ensureFolder(folderForType(type));
    this.data.resources ??= [];
    this.data.resources.push({ id: { name, path: relPath } });
  }

  /** Remove a resource entry from the .yyp (does not delete files). */
  removeResourceEntry(name) {
    this.data.resources = (this.data.resources ?? []).filter((r) => r.id.name !== name);
    this.data.RoomOrderNodes = (this.data.RoomOrderNodes ?? []).filter((n) => n.roomId.name !== name);
  }

  addRoomOrder(roomName, relPath) {
    this.data.RoomOrderNodes ??= [];
    if (!this.data.RoomOrderNodes.some((n) => n.roomId.name === roomName)) {
      this.data.RoomOrderNodes.push({ roomId: { name: roomName, path: relPath } });
    }
  }

  setFirstRoom(roomName) {
    const r = this.findResource(roomName);
    if (!r || r.type !== "GMRoom") throw new Error(`Room "${roomName}" not found in project.`);
    this.data.RoomOrderNodes ??= [];
    this.data.RoomOrderNodes = this.data.RoomOrderNodes.filter((n) => n.roomId.name !== roomName);
    this.data.RoomOrderNodes.unshift({ roomId: { name: roomName, path: r.path } });
    this.save();
    return this.roomOrder();
  }

  /** Read a text file (GML code) relative to the project root. */
  readText(rel) {
    return fs.readFileSync(this.abs(rel), "utf8");
  }

  /** Write a text file (GML code) relative to the project root. */
  writeText(rel, text) {
    writeText(this.abs(rel), text);
  }

  /** Delete a resource's folder and its .yyp entry. */
  deleteResource(name) {
    const r = this.findResource(name);
    if (!r) throw new Error(`Resource "${name}" not found.`);
    const dir = path.join(this.root, path.dirname(r.path));
    fs.rmSync(dir, { recursive: true, force: true });
    this.removeResourceEntry(name);
  }
}

export function folderForType(type) {
  const dir = TYPE_DIRS[type];
  if (!dir) throw new Error(`No folder mapping for type ${type}`);
  const names = {
    scripts: "Scripts",
    objects: "Objects",
    rooms: "Rooms",
    sprites: "Sprites",
    sounds: "Sounds",
    shaders: "Shaders",
    fonts: "Fonts",
    tilesets: "Tile Sets",
    sequences: "Sequences",
    timelines: "Timelines",
    paths: "Paths",
    extensions: "Extensions",
    animationcurves: "Animation Curves",
    notes: "Notes",
    particles: "Particle Systems",
  };
  return names[dir] ?? dir;
}

