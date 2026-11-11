const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("chart legend normal-size text meets 4.5:1 and cannot regress to #777", () => {
  const app = read("docs/app.js");
  assert.ok(app.includes('style="color:#666"'));
  assert.ok(!app.includes('style="color:#777"'));
  const channel = 0x66 / 255;
  const luminance = ((channel + 0.055) / 1.055) ** 2.4;
  assert.ok(1.05 / (luminance + 0.05) >= 4.5);
});

test("accessibility statement is in the interface and explains manual gaps", () => {
  const statement = read("docs/index.html");
  assert.ok(statement.includes('href="#accessibility"'));
  assert.ok(statement.includes('id="accessibility"'));
  const catalog = JSON.parse(read("docs/i18n/strings.json"));
  for (const code of Object.keys(catalog.languages)) {
    assert.ok(catalog.strings["a11y.target"][code]);
    assert.ok(catalog.strings["a11y.limits"][code]);
  }
  assert.ok(statement.includes("https://github.com/reihlinstinct/gemel-what-if/issues/109"));
});
