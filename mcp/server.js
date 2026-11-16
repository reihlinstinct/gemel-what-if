#!/usr/bin/env node
/* Minimal MCP server (stdio, JSON-RPC 2.0, newline-delimited). Zero dependencies.
 * Privacy: stories are never stored or sent anywhere. Logic lives in core.js (shared with the Worker). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createCore } = require("./core.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/data/funds.json"), "utf8"));
const core = createCore(DATA);

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const res = core.handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}

module.exports = { handle: core.handle, validate: core.validate, link: core.link };
