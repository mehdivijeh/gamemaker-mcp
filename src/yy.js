// Tolerant reader/writer for GameMaker "relaxed JSON" (.yy / .yyp).
//
// GameMaker writes JSON with trailing commas (e.g. `{"a":1,},`). That is not
// valid JSON, so before parsing we strip trailing commas with a
// string-aware state machine. When writing we emit plain JSON - GameMaker
// parses it fine and rewrites files in its own style on the next save.

import fs from "node:fs";
import path from "node:path";

/**
 * Remove trailing commas before `}` / `]` without touching string contents.
 * @param {string} text
 * @returns {string}
 */
export function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let pendingComma = -1; // index in `out` of a comma that may be trailing

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      pendingComma = out.length;
      out += ch;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (pendingComma >= 0) {
        out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
        pendingComma = -1;
      }
      out += ch;
      continue;
    }
    if (!/\s/.test(ch)) pendingComma = -1;
    out += ch;
  }
  return out;
}

/**
 * Parse the text of a .yy / .yyp file (relaxed JSON).
 * @param {string} text
 * @returns {any}
 */
export function parseYY(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripTrailingCommas(text));
  }
}

/**
 * Read and parse a .yy / .yyp file.
 * @param {string} file
 * @returns {any}
 */
export function readYY(file) {
  return parseYY(fs.readFileSync(file, "utf8"));
}

/**
 * Serialize an object as (valid) JSON text in GameMaker-friendly style.
 * @param {any} value
 * @returns {string}
 */
export function toYYText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * Write an object to a .yy / .yyp file as JSON.
 * @param {string} file
 * @param {any} value
 */
export function writeYY(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toYYText(value), "utf8");
}

/**
 * Write plain text (e.g. GML) to a file, creating parent folders.
 * @param {string} file
 * @param {string} text
 */
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/**
 * Tag every plain object in a GameMaker .yy document the way the IDE does:
 * every resource object carries `"resourceType"` and `"resourceVersion"`.
 * This helper only sets defaults when the caller did not provide them.
 * @param {Record<string, any>} obj
 * @param {string} resourceType
 * @param {string} resourceVersion
 */
export function tag(obj, resourceType, resourceVersion = "2.0") {
  if (obj.resourceType === undefined) obj.resourceType = resourceType;
  if (obj.resourceVersion === undefined) obj.resourceVersion = resourceVersion;
  return obj;
}
