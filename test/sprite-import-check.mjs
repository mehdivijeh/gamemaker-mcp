// Validate gm_import_sprite output by compiling a project that contains an
// imported sprite (Igor's parser is strict about the .yy structure).

import { GMProject } from "../src/project.js";
import { importSprite } from "../src/creators.js";

const yyp = "/tmp/gm_e2e/probe_game/simple_platformer.yyp";
const p = new GMProject(yyp);
const frame = "/tmp/gm_e2e/probe_game/sprites/sPlayer/61513b0c-5dcc-4b12-b976-c2d441244ab8.png";
const res = importSprite(p, "spr_mcp_import_test", [frame, frame], { fps: 24 });
console.log("imported:", JSON.stringify(res));
