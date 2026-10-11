// Tests for the Node-side bridge client against a fake GML game server
// (raw TCP, newline-delimited JSON - like network_create_server_raw).

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { BridgeClient, asciiSafeJson, connectToGame } from "../src/bridge.js";

function startFakeGame(startPort = 0) {
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          continue;
        }
        const res = { id: req.id, ok: true };
        if (req.cmd === "ping") res.pong = true;
        else if (req.cmd === "info") res.room = "rm_main";
        else if (req.cmd === "room.restart") res.room = "rm_main";
        else if (req.cmd === "game.restart") res.restarted = true;
        else if (req.cmd === "mouse.pos") { res.x = req.args.x; res.y = req.args.y; }
        else if (req.cmd === "echo") res["caf\u00e9"] = req.args.text;
        else if (req.cmd === "utf8") res.text = "h\u00e9llo w\u00f6rld \u2615";
        else res.echoArgs = req.args;
        // reply with UTF-8 (like GML json_stringify would)
        sock.write(JSON.stringify(res) + "\n", "utf8");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(startPort, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test("asciiSafeJson escapes non-ASCII characters", () => {
  const out = asciiSafeJson({ text: "caf\u00e9" });
  assert.ok(/^[\x00-\x7F]*$/.test(out));
  assert.ok(out.includes("\\u00e9"));
  assert.deepEqual(JSON.parse(out), { text: "caf\u00e9" });
});

test("client sends commands and parses responses", async () => {
  const { server, port } = await startFakeGame();
  try {
    const client = new BridgeClient(port);
    await client.connect();
    const pong = await client.ping();
    assert.equal(pong.pong, true);
    const info = await client.info();
    assert.equal(info.room, "rm_main");
    const rroom = await client.restartRoom();
    assert.equal(rroom.room, "rm_main");
    const rgame = await client.restartGame();
    assert.equal(rgame.restarted, true);
    const mpos = await client.setMouse(100, 200);
    assert.equal(mpos.x, 100);
    assert.equal(mpos.y, 200);
    const echo = await client.send("echo", { text: "h\u00e9llo" });
    assert.equal(echo["caf\u00e9"], "h\u00e9llo");
    const utf8 = await client.send("utf8");
    assert.equal(utf8.text, "h\u00e9llo w\u00f6rld \u2615");
    client.close();
  } finally {
    server.close();
  }
});

test("request timeout rejects", async () => {
  const dead = await new Promise((resolve) => {
    // a server that accepts but never replies
    const s = net.createServer(() => {});
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
  try {
    const client = new BridgeClient(dead.port);
    await client.connect();
    await assert.rejects(() => client.send("ping", {}, 300), /timed out/);
    client.close();
  } finally {
    dead.s.close();
  }
});

test("connectToGame scans ports until one answers with a pong", async () => {
  const { server, port } = await startFakeGame();
  try {
    // occupy the next port with a non-responding server
    const block = await new Promise((resolve) => {
      const s = net.createServer(() => {});
      s.listen(port + 1, "127.0.0.1", () => resolve({ s, port: s.address().port }));
    });
    const client = await connectToGame(port, 4);
    assert.equal(client.port, port);
    client.close();
    block.s.close();
  } finally {
    server.close();
  }
});
