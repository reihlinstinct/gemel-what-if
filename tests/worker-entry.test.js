const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {pathToFileURL} = require("node:url");
const path = require("node:path");

test("actual Worker entry assembles pension data before handling a public MCP request", async () => {
  const filename = path.resolve(__dirname,"../worker/src/index.js");
  // Node needs JSON import attributes; the deployment bundler accepts the source imports.
  const source = fs.readFileSync(filename,"utf8").replace(/from "([^"]+)";/g, (_, relative) => {
    const url = new URL(relative,pathToFileURL(filename)).href;
    return 'from "'+url+'"'+(relative.endsWith(".json")?' with { type: "json" }':'')+';';
  });
  const entry = await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  const response = await entry.default.fetch(new Request("https://worker.test/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"search_tracks",arguments:{query:"2155",limit:40}}})}),{});
  assert.equal(response.status,200);
  const body=await response.json();
  const tracks=JSON.parse(body.result.content[0].text);
  assert(tracks.some(f=>f.fundKey==="p:2155"));
});
