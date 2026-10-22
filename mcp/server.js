#!/usr/bin/env node
/* Minimal MCP server (stdio, JSON-RPC 2.0, newline-delimited). Zero dependencies.
 * Privacy: stories are never stored or sent anywhere. The server reads the bundled public
 * data file and the engine, and returns links whose story lives in the URL fragment. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const W = require("../docs/whatif.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/data/funds.json"), "utf8"));
const FUNDS = W.indexFunds(DATA);
const DEFAULT_BASE = "https://reihlinstinct.github.io/gemel-what-if/";
const TYPES = ["start", "deposit", "monthly", "withdraw", "transfer", "product", "track", "fees"];
const SWITCHES = ["transfer", "product", "track"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

const STORY_SCHEMA = {
  type: "object",
  description:
    "Timeline story. events: one {type:'start', date:'YYYY-MM', fundKey, amount?} first, then deposit {date, amount}, " +
    "monthly {from, to?, amount}, withdraw {date, amount}, transfer|product|track {date, fundKey, exitCostPct?, feeAdjPct?}, fees {date, depositPct?, savingsPct?} (optional management fees, off by default; savingsPct is yearly). " +
    "Any event may carry scope: both|actual|whatif. fundKey comes from search_tracks (g:<id> gemel, i:<id> insurance). " +
    "Optional annuity {guaranteed, market, months, rate} (strings).",
  properties: { end: { type: "string" }, events: { type: "array", items: { type: "object" } }, annuity: { type: "object" } },
  required: ["events"],
};

function validate(story) {
  const errors = [];
  const warnings = [];
  if (!story || !Array.isArray(story.events)) return { errors: ["events must be an array"], warnings };
  if (story.end && !MONTH.test(story.end)) errors.push("end must be YYYY-MM");
  const starts = story.events.filter((e) => e && e.type === "start");
  if (starts.length !== 1) errors.push("exactly one start event is required");
  story.events.forEach((e, i) => {
    const at = "event " + i + " (" + (e && e.type) + "): ";
    if (!e || !TYPES.includes(e.type)) return errors.push(at + "unknown type");
    if (e.scope && !["both", "actual", "whatif"].includes(e.scope)) errors.push(at + "bad scope");
    if (e.type === "monthly") {
      if (!MONTH.test(e.from || "")) errors.push(at + "from must be YYYY-MM");
      if (e.to && !MONTH.test(e.to)) errors.push(at + "to must be YYYY-MM");
    } else if (!MONTH.test(e.date || "")) errors.push(at + "date must be YYYY-MM");
    if (["deposit", "monthly", "withdraw"].includes(e.type) && !(Number(e.amount) > 0)) errors.push(at + "amount must be > 0");
    if ((e.type === "start" || SWITCHES.includes(e.type))) {
      const f = FUNDS.get(e.fundKey);
      if (!f) errors.push(at + "unknown fundKey " + e.fundKey);
      else if (e.date && MONTH.test(e.date)) {
        const idx = W.toIndex(e.date);
        const [a, b] = W.dataRange(f);
        if (idx < a || idx > b) warnings.push(at + f.name + " has no reported yields in " + e.date + " (data " + f.start + "-" + f.end + ")");
      }
    }
  });
  if (!errors.length) {
    try {
      W.runTimeline(story, FUNDS, DATA.latest);
    } catch (err) {
      errors.push(String(err.message));
    }
  }
  return { errors, warnings };
}

function link(story, base) {
  const b64 = Buffer.from(JSON.stringify(story), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return (base || DEFAULT_BASE) + "#story=" + b64;
}

const TOOLS = {
  search_tracks: {
    description: "Search official tracks by name, company or id. Returns fundKey, name, product, data range.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    run: (a) => W.searchFunds(DATA, a.query, Math.min(a.limit || 15, 40)).map((f) => ({ fundKey: f.key, name: f.name, product: f.src, company: f.corp, class: f.cls, start: f.start, end: f.end })),
  },
  validate_story: {
    description: "Validate a timeline story (types, dates, known fundKeys, data coverage). Nothing is stored.",
    inputSchema: { type: "object", properties: { story: STORY_SCHEMA }, required: ["story"] },
    run: (a) => validate(a.story),
  },
  build_story_link: {
    description: "Validate a story and return a link that opens the site with the story in the URL fragment (the fragment is never sent to a server). Treat the link as private.",
    inputSchema: { type: "object", properties: { story: STORY_SCHEMA, baseUrl: { type: "string" } }, required: ["story"] },
    run: (a) => {
      const v = validate(a.story);
      if (v.errors.length) return v;
      return { url: link(a.story, a.baseUrl), warnings: v.warnings };
    },
  },
  compute_story: {
    description: "Run the story locally and return totals for the actual and what-if scenarios (estimate, not advice).",
    inputSchema: { type: "object", properties: { story: STORY_SCHEMA }, required: ["story"] },
    run: (a) => {
      const v = validate(a.story);
      if (v.errors.length) return v;
      const r = W.runTimeline(a.story, FUNDS, DATA.latest);
      const pick = (x) => ({ deposited: x.paid, withdrawn: x.withdrawn, finalValue: x.final, totalProfit: x.gain, annualReturn: x.annualized });
      return { actual: pick(r.actual), whatIf: pick(r.whatIf), difference: r.diff, warnings: v.warnings, note: "Estimate from reported monthly yields; not financial advice." };
    },
  },
};

function handle(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return ok({ protocolVersion: (params && params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gemel-what-if", version: "0.1.0" } });
  }
  if (method === "tools/list") {
    return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = TOOLS[params && params.name];
    if (!tool) return err(-32602, "unknown tool");
    try {
      const out = tool.run((params && params.arguments) || {});
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: Boolean(out && out.errors && out.errors.length) });
    } catch (e) {
      return ok({ content: [{ type: "text", text: String(e.message) }], isError: true });
    }
  }
  if (method === "ping") return ok({});
  if (id === undefined) return null; // notification
  return err(-32601, "method not found");
}

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
    const res = handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}

module.exports = { handle, validate, link };
