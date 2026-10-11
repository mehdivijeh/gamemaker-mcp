// Mapping between human-friendly event names and GameMaker event
// (eventType, eventNum) pairs, plus the event file naming convention
// (e.g. Create_0.gml, Step_0.gml, Draw_64.gml, Other_68.gml).
//
// Async event IDs confirmed against the GameMaker LTS 2026 manual
// ("Async Events" page) and the GmlSpec.xml shipped with runtime 2026.0.0.23.

/** GameMaker event type ids (event_type). */
export const EVENT_TYPES = {
  create: 0,
  destroy: 1,
  alarm: 2,
  step: 3,
  collision: 4,
  keyboard: 5,
  mouse: 6,
  other: 7,
  draw: 8,
  keypress: 9,
  keyrelease: 10,
  trigger: 11,
  cleanup: 12,
  gesture: 13,
  precreate: 14,
};

/** File name prefix per event type, as used by GameMaker event file names. */
export const FILE_PREFIX = {
  0: "Create",
  1: "Destroy",
  2: "Alarm",
  3: "Step",
  4: "Collision",
  5: "Keyboard",
  6: "Mouse",
  7: "Other",
  8: "Draw",
  9: "KeyPress",
  10: "KeyRelease",
  11: "Trigger",
  12: "CleanUp",
  13: "Gesture",
  14: "PreCreate",
};

/**
 * Canonical event name -> [eventType, eventNum].
 * Async ids: manual "Async Events" -> EVENT_OTHER_* constants:
 * 60 image loaded / 61 sound load / 62 http / 63 dialog / 66 iap / 67 cloud /
 * 68 networking / 69 steam / 70 social / 71 push / 72 save-load /
 * 73 audio recording / 74 audio playback / 75 system / 76 broadcast.
 */
const TABLE = {
  "create": [0, 0],
  "destroy": [1, 0],
  "clean up": [12, 0],
  "pre-create": [14, 0],

  "step": [3, 0],
  "begin step": [3, 1],
  "end step": [3, 2],

  "draw": [8, 0],
  "draw gui": [8, 64],
  "draw begin": [8, 72],
  "draw end": [8, 73],
  "draw gui begin": [8, 74],
  "draw gui end": [8, 75],
  "pre-draw": [8, 76],
  "post-draw": [8, 77],

  "outside room": [7, 0],
  "intersect boundary": [7, 1],
  "game start": [7, 2],
  "game end": [7, 3],
  "room start": [7, 4],
  "room end": [7, 5],
  "no more lives": [7, 6],
  "animation end": [7, 7],
  "end of path": [7, 8],
  "no more health": [7, 9],
  "close button": [7, 30],
  "animation update": [7, 60],
  "async - image loaded": [7, 61],
  "async - http": [7, 62],
  "async - dialog": [7, 63],
  "async - iap": [7, 66],
  "async - in-app purchase": [7, 66],
  "async - cloud": [7, 67],
  "async - networking": [7, 68],
  "async - steam": [7, 69],
  "async - social": [7, 70],
  "async - push notification": [7, 71],
  "async - save/load": [7, 72],
  "async - audio recording": [7, 73],
  "async - audio playback": [7, 74],
  "async - system": [7, 75],
  "broadcast message": [7, 76],
};


function norm(name) {
  return String(name)
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finish(eventType, eventNum) {
  const prefix = FILE_PREFIX[eventType];
  return {
    eventType,
    eventNum,
    canonicalName: eventName(eventType, eventNum),
    fileName: `${prefix}_${eventNum}.gml`,
  };
}

/**
 * Resolve an event name (or "Type:Num" / "Type_Num" spec) into
 * { eventType, eventNum, canonicalName, fileName }.
 *
 * Accepts e.g.: "Create", "Step", "End Step", "Draw GUI", "Alarm 3",
 * "Other:68", "Async - Networking", "User 5", "Outside View 2".
 *
 * Collision events are intentionally unsupported: GameMaker hashes the
 * collided object's name into eventNum, which we cannot reproduce safely.
 * @param {string} spec
 */
export function resolveEvent(spec) {
  const raw = String(spec).trim();

  // Raw form "Type:Num" / "Type_Num" (e.g. Other:68, Draw_64)
  const rawMatch = raw.match(/^([A-Za-z][A-Za-z ]*?)\s*[:#_]\s*(\d+)$/);
  if (rawMatch) {
    const typeName = norm(rawMatch[1]).replace(/ /g, "");
    const num = Number(rawMatch[2]);
    let id = EVENT_TYPES[typeName];
    if (id === undefined) {
      for (const [numId, prefix] of Object.entries(FILE_PREFIX)) {
        if (norm(prefix).replace(/ /g, "") === typeName) id = Number(numId);
      }
    }
    if (id !== undefined && id !== 4) return finish(id, num);
  }

  const key = norm(raw);

  const alarm = key.match(/^alarm ?(\d{1,2})$/);
  if (alarm) {
    const n = Number(alarm[1]);
    if (n < 0 || n > 11) throw new Error(`Alarm index out of range: ${n}`);
    return finish(2, n);
  }

  const user = key.match(/^user ?(\d{1,2})$/);
  if (user) {
    const n = Number(user[1]);
    if (n < 0 || n > 15) throw new Error(`User event index out of range: ${n}`);
    return finish(7, 10 + n);
  }

  const view = key.match(/^(outside|boundary) view ?(\d)$/);
  if (view) {
    const base = view[1] === "outside" ? 40 : 50;
    return finish(7, base + Number(view[2]));
  }

  if (TABLE[key]) return finish(TABLE[key][0], TABLE[key][1]);

  const alias = {
    "asyncnetworking": [7, 68],
    "networking": [7, 68],
    "asynchttp": [7, 62],
    "http": [7, 62],
    "asyncsystem": [7, 75],
    "system": [7, 75],
    "beginstep": [3, 1],
    "endstep": [3, 2],
    "stepbegin": [3, 1],
    "stepend": [3, 2],
    "drawgui": [8, 64],
    "gui": [8, 64],
    "drawguibegin": [8, 74],
    "guibegin": [8, 74],
    "drawguiend": [8, 75],
    "guiend": [8, 75],
    "drawbegin": [8, 72],
    "drawend": [8, 73],
    "predraw": [8, 76],
    "postdraw": [8, 77],
    "cleanup": [12, 0],
    "precreate": [14, 0],
    "roomstart": [7, 4],
    "roomend": [7, 5],
    "gamestart": [7, 2],
    "gameend": [7, 3],
    "animationend": [7, 7],
  };
  const compact = key.replace(/ /g, "");
  if (alias[compact]) return finish(alias[compact][0], alias[compact][1]);

  const known = Object.keys(TABLE).map((k) => `"${k}"`).join(", ");
  throw new Error(`Unknown event "${spec}". Supported names include: ${known}, plus "User N", "Alarm N", "Outside View N".`);
}

/** Reverse lookup used when listing an object's events. */
export function eventName(eventType, eventNum) {
  for (const [name, [t, n]] of Object.entries(TABLE)) {
    if (t === eventType && n === eventNum) return title(name);
  }
  if (eventType === 2) return `Alarm ${eventNum}`;
  if (eventType === 7 && eventNum >= 10 && eventNum <= 25) return `User ${eventNum - 10}`;
  if (eventType === 7 && eventNum >= 40 && eventNum <= 47) return `Outside View ${eventNum - 40}`;
  if (eventType === 7 && eventNum >= 50 && eventNum <= 57) return `Boundary View ${eventNum - 50}`;
  return `${FILE_PREFIX[eventType] ?? "Event"}_${eventNum}`;
}

function title(s) {
  return s
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGui\b/g, "GUI")
    .replace(/\bIap\b/g, "IAP");
}
