const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/data/funds.json"), "utf8"));

test("bundled data has the expected shape", () => {
  assert.ok(data.funds.length > 500);
  assert.ok(data.latest >= 202401);
  for (const f of data.funds) {
    assert.ok(Number.isInteger(f.id));
    assert.strictEqual(f.y.length, (Math.floor(f.end / 100) - Math.floor(f.start / 100)) * 12 + (f.end % 100) - (f.start % 100) + 1);
  }
});
