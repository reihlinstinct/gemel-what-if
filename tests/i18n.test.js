// i18n: docs/i18n/strings.json is the only source of languages. These tests read the language list from the
// catalog and never from a literal list, so adding a language block (and its values) needs no change here.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../docs/i18n.js");
const P = require("../docs/prompt.js");

const repo = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const catalog = JSON.parse(read("docs/i18n/strings.json"));
const codes = Object.keys(catalog.languages);
const keys = Object.keys(catalog.strings);
const def = codes.find((c) => catalog.languages[c].default);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, "\u00a0").replace(/&amp;/g, "&");
const HEBREW = /[\u0590-\u05ff]/;

test("catalog: one block per language with its own name, direction, locale and status; exactly one default", () => {
  assert.ok(codes.length >= 1);
  assert.strictEqual(codes.filter((c) => catalog.languages[c].default).length, 1, "exactly one default language");
  for (const c of codes) {
    const l = catalog.languages[c];
    assert.match(c, /^[a-z]{2,3}$/, c + ": code");
    assert.ok(typeof l.name === "string" && l.name.trim(), c + ": own name (endonym) for the picker");
    assert.ok(l.dir === "rtl" || l.dir === "ltr", c + ": dir");
    assert.match(l.locale, new RegExp("^" + c + "-[A-Z]{2}$"), c + ": locale for numbers and og:locale");
    // The default language is the source; every other language says whether it is still a machine draft.
    assert.ok(c === def ? l.status === "source" : ["machine-draft", "reviewed"].includes(l.status), c + ": status " + l.status);
  }
});

test("parity: every language has every key, non-empty, with the same placeholders as the default", () => {
  for (const k of keys) {
    for (const c of codes) {
      const v = catalog.strings[k][c];
      assert.ok(typeof v === "string" && v.trim() !== "", k + " has no " + c + " value");
      assert.deepStrictEqual(placeholders(v), placeholders(catalog.strings[k][def]), k + ": placeholders differ in " + c);
    }
    assert.deepStrictEqual(Object.keys(catalog.strings[k]).sort(), [...codes].sort(), k + ": values only for catalog languages");
  }
});

test("languages are discovered only from the catalog: a new language block is picked up with no code change", () => {
  assert.deepStrictEqual(I18n.create(catalog).languages(), codes);
  const extra = JSON.parse(JSON.stringify(catalog));
  extra.languages.xx = { name: "Xx-own-name", dir: "ltr", locale: "xx-XX", status: "machine-draft" };
  for (const k of keys) extra.strings[k].xx = "xx:" + extra.strings[k][def];
  const L = I18n.create(extra, I18n.langFromSearch(extra, "?lang=xx"));
  assert.deepStrictEqual(L.languages(), codes.concat("xx"));
  assert.strictEqual(L.lang(), "xx");
  assert.strictEqual(L.locale(), "xx-XX");
  assert.strictEqual(L.t("ui.language"), "xx:" + catalog.strings["ui.language"][def]);
  assert.strictEqual(I18n.langFromSearch(catalog, "?lang=zz"), null, "an unknown ?lang= falls back to the default");
  assert.strictEqual(I18n.create(catalog, null).lang(), def);
});

test("t(): placeholders, the default-language fallback and unknown keys", () => {
  const L = I18n.create(catalog);
  assert.strictEqual(L.t("data.info", { latest: "2026-09", count: 12 }), catalog.strings["data.info"][def].replace("{latest}", "2026-09").replace("{count}", "12"));
  // A passed but undefined value prints as before the catalog ("" + undefined), so the output stays identical.
  assert.ok(L.t("error.missing_fund", { type: undefined }).endsWith(" undefined"));
  assert.strictEqual(L.t("no.such.key"), "no.such.key");
  const partial = { languages: { ...catalog.languages, xx: { name: "X", dir: "ltr", locale: "xx-XX", status: "machine-draft" } }, strings: { a: { [def]: "A {n}" } } };
  assert.strictEqual(I18n.create(partial, "xx").t("a", { n: 1 }), "A 1", "a missing value falls back to the default language");
});

// A minimal document for I18n.apply: elements with attributes, found by [attr] / tag[attr="v"] / #id.
function fakeDocument(specs) {
  const make = (tag, attrs) => ({
    tag, attrs: { ...attrs }, textContent: "", children: [], hidden: true,
    getAttribute(n) { return this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = String(v); }, hasAttribute(n) { return n in this.attrs; },
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; }, get innerHTML() { return this._html || ""; },
    appendChild(c) { this.children.push(c); }, closest() { return this.parent; },
  });
  const all = specs.map((s) => make(s.tag, s.attrs));
  const wrap = make("label", { class: "lang-pick" });
  const sel = make("select", { id: "lang" });
  sel.parent = wrap;
  const match = (sel, e) => {
    const m = /^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    return m && (!m[1] || m[1] === e.tag) && e.hasAttribute(m[2]) && (m[3] === undefined || e.attrs[m[2]] === m[3]);
  };
  return {
    documentElement: { lang: "", dir: "" }, all, wrap, sel, draft: make("p", {}),
    querySelectorAll(s) { return all.filter((e) => match(s, e)); },
    querySelector(s) { return all.find((e) => match(s, e)) || null; },
    getElementById(id) { return id === "lang" ? sel : id === "translation-draft" ? this.draft : null; },
    createElement(tag) { return make(tag, {}); },
  };
}

test("picker shows exactly the catalog languages, in catalog order, by their own names; hidden with one language", () => {
  const run = (cat, search) => {
    const doc = fakeDocument([{ tag: "meta", attrs: { property: "og:locale", content: "" } }, { tag: "h1", attrs: { "data-i18n": "page.heading" } }]);
    const L = I18n.create(cat, I18n.langFromSearch(cat, search));
    let picked = null;
    I18n.apply(L, doc, (c) => { picked = c; });
    return { doc, L, pick: (c) => { doc.sel.value = c; doc.sel.onchange(); return picked; } };
  };
  const one = run(catalog, "");
  assert.deepStrictEqual(one.doc.sel.children.map((o) => [o.value, o.textContent]), codes.map((c) => [c, catalog.languages[c].name]));
  assert.strictEqual(one.doc.wrap.hidden, codes.length < 2);
  assert.strictEqual(one.doc.documentElement.lang, def);
  assert.strictEqual(one.doc.documentElement.dir, catalog.languages[def].dir);
  assert.strictEqual(one.doc.all[0].attrs.content, catalog.languages[def].locale.replace("-", "_"));
  assert.strictEqual(one.doc.all[1].textContent, catalog.strings["page.heading"][def]);
  const two = JSON.parse(JSON.stringify(catalog));
  two.languages.xx = { name: "Xx-own-name", dir: "ltr", locale: "xx-XX", status: "machine-draft" };
  for (const k of keys) two.strings[k].xx = "x";
  const r = run(two, "?lang=xx");
  assert.deepStrictEqual(r.doc.sel.children.map((o) => o.textContent), Object.keys(two.languages).map((c) => two.languages[c].name));
  assert.strictEqual(r.doc.wrap.hidden, false);
  assert.strictEqual(r.doc.sel.value, "xx");
  assert.strictEqual(r.doc.documentElement.dir, "ltr");
  assert.strictEqual(r.pick(def), def, "choosing an option hands its code to the page");
});

// index.html carries the default language baked in, so the page reads the same before scripts run and for
// crawlers. Each baked text must equal the catalog's default value, and no UI text may be left untagged.
const html = read("docs/index.html");
const tagged = [];
for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-i18n(-html)?="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) tagged.push({ key: m[4], html: !!m[3], inner: m[6], start: m.index, end: m.index + m[0].length });
const attrTagged = [];
for (const m of html.matchAll(/<\w+[^>]*>/g)) {
  for (const a of m[0].matchAll(/\sdata-i18n-(content|placeholder|aria-label)="([^"]+)"/g)) {
    const v = new RegExp("\\s" + a[1] + '="([^"]*)"').exec(m[0]);
    attrTagged.push({ key: a[2], attr: a[1], value: v && v[1] });
  }
}

test("index.html: the baked text equals the catalog's default language, byte for byte", () => {
  assert.ok(tagged.length > 30 && attrTagged.length > 5);
  for (const t of tagged) {
    assert.ok(catalog.strings[t.key], "unknown key " + t.key);
    assert.strictEqual(t.html ? t.inner : decode(t.inner), catalog.strings[t.key][def], t.key);
    if (!t.html) assert.ok(!/<\w/.test(t.inner), t.key + ": markup inside a text element; use data-i18n-html");
  }
  for (const a of attrTagged) assert.strictEqual(decode(a.value || ""), catalog.strings[a.key][def], a.key + " (" + a.attr + ")");
  const meta = catalog.languages[def];
  assert.ok(html.includes('<html lang="' + def + '" dir="' + meta.dir + '">'), "<html lang dir> baked from the default language");
  assert.ok(html.includes('<meta property="og:locale" content="' + meta.locale.replace("-", "_") + '">'), "og:locale baked from the default language");
});

test("index.html: no user-visible text outside a catalog key", () => {
  // Walks tags and text in order; script and style bodies are not page text.
  const inTagged = (i) => tagged.some((t) => i >= t.start && i < t.end);
  const left = [];
  let skip = null;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      if (!skip && !inTagged(m.index) && HEBREW.test(m[4])) left.push(m[4].trim());
      continue;
    }
    const name = m[2].toLowerCase();
    if (skip) { if (m[1] && name === skip) skip = null; continue; }
    if (!m[1] && (name === "script" || name === "style")) { skip = name; continue; }
    if (inTagged(m.index)) continue;
    for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (HEBREW.test(a[2]) && !m[3].includes("data-i18n-" + a[1] + "=")) left.push(name + " " + a[1] + "=" + a[2]);
    }
  }
  assert.deepStrictEqual(left, []);
});

// Every key the code asks for exists, and every catalog key is used somewhere (no dead text).
test("every key used exists in the catalog, and every catalog key is used", () => {
  const app = read("docs/app.js");
  const worker = read("worker/src/handler.js");
  const used = new Set();
  for (const m of app.matchAll(/\bt\("([\w.]+)"[,)]/g)) used.add(m[1]);
  for (const m of app.matchAll(/"((?:event|verify)\.\w+)"/g)) used.add(m[1]); // TYPES values and site names, read through t()
  for (const n of [1, 2, 3, 4]) used.add("notes.item" + n); // app.js: [1, 2, 3, 4].map((n) => t("notes.item" + n))
  for (const t of tagged.concat(attrTagged)) used.add(t.key);
  for (const m of worker.matchAll(/\b(?:fail|errorBody)\("(\w+)"/g)) used.add("worker." + m[1]);
  for (const m of read("docs/prompt.js").matchAll(/i18nKey = "([\w.]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(catalog.strings[k], "used but missing from the catalog: " + k);
  assert.deepStrictEqual(keys.filter((k) => !used.has(k)), [], "catalog keys nobody uses");
});

test("app.js and the Worker carry no Hebrew UI text of their own", () => {
  assert.ok(!HEBREW.test(read("docs/app.js")), "docs/app.js");
  // handler.js: only the AI system prompt (do-not-translate: it names Hebrew company names on purpose).
  const lines = read("worker/src/handler.js").split("\n").filter((l) => HEBREW.test(l));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].trim().startsWith('"Workflow: call search_tracks once per fund'), lines[0].slice(0, 60));
});

test("prompt.js: its one error carries a catalog key, and its model-facing words equal the catalog text", () => {
  try {
    P.extractJson("no json");
    assert.fail("should throw");
  } catch (e) {
    assert.strictEqual(e.i18nKey, "prompt.no_json");
    assert.strictEqual(e.message, catalog.strings["prompt.no_json"][def]);
  }
});

// Tripwire: a language code written anywhere outside the catalog is a second language list. Scanned: every
// tracked source file except data. Allowed, each with its reason, and nothing else.
const COMMON = ["he", "en", "fr", "ar", "ru", "am", "de", "es", "it", "pt", "uk", "yi", "zh", "ja"]; // codes to catch even before they are in the catalog
const ALLOW = [
  // the default language baked into the static page; checked against the catalog above
  { file: "docs/index.html", text: '<html lang="he" dir="rtl">' },
  { file: "docs/index.html", text: '<meta property="og:locale" content="he_IL">' },
  // the recorded Hebrew UI tour (e2e/he-snapshot.js), recorded output and not code
  { file: "e2e/he-snapshot.js", text: '"lang=he dir=rtl"' },
  { file: "e2e/he-snapshot.js", text: '"meta=he_IL"' },
];
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) { if (!["node_modules", "data", ".git"].includes(e.name)) walk(p); }
      else if (/\.(js|mjs|html|py|json|toml)$/.test(e.name) && p !== "docs/i18n/strings.json" && p !== "tests/i18n.test.js") out.push(p);
    }
  };
  for (const d of ["docs", "worker", "mcp", "e2e", "tests", "scripts", "tools"]) if (fs.existsSync(path.join(repo, d))) walk(d);
  return out;
}
function hardcodedLanguages(file, text) {
  const langs = new Set(codes.concat(COMMON));
  for (const a of ALLOW) if (a.file === file) text = text.split(a.text).join("");
  const hits = [];
  for (const m of text.matchAll(/(["'`])([a-z]{2,3}(?:[-_][A-Z]{2})?)\1/g)) {
    const v = m[2];
    if (langs.has(v.slice(0, v.length > 3 ? v.search(/[-_]/) : v.length)) && (v.length <= 3 ? langs.has(v) : true)) hits.push(v);
  }
  for (const m of text.matchAll(/\blang=["']?([a-z]{2,3})\b/g)) if (langs.has(m[1])) hits.push("lang=" + m[1]);
  for (const m of text.matchAll(/=([a-z]{2}_[A-Z]{2})\b|"([a-z]{2}_[A-Z]{2})"/g)) hits.push(m[1] || m[2]);
  return [...new Set(hits)];
}

test("no language code is hardcoded outside the catalog", () => {
  const files = sources();
  assert.ok(files.includes("docs/app.js") && files.includes("worker/src/handler.js") && files.includes("e2e/shared.js"));
  const found = files.map((f) => [f, hardcodedLanguages(f, read(f))]).filter(([, h]) => h.length);
  assert.deepStrictEqual(found, []);
});

test("the tripwire itself catches a stray code, a locale and a lang attribute", () => {
  assert.deepStrictEqual(hardcodedLanguages("x.js", 'const a = "fr";'), ["fr"]);
  assert.deepStrictEqual(hardcodedLanguages("x.js", 'n.toLocaleString("he-IL")'), ["he-IL"]);
  assert.deepStrictEqual(hardcodedLanguages("x.html", '<p lang="ar">'), ["ar", "lang=ar"]);
  assert.deepStrictEqual(hardcodedLanguages("x.js", 'const k = "id"; const t = "amount";'), []);
});


test("French is a complete flagged draft and makes the real picker visible", () => {
  assert.strictEqual(catalog.languages.fr.status, "machine-draft");
  assert.strictEqual(catalog.languages.fr.machine_draft, true);
  const doc = fakeDocument([{ tag: "h1", attrs: { "data-i18n": "page.heading" } }]);
  const L = I18n.create(catalog, I18n.langFromSearch(catalog, "?lang=fr"));
  I18n.apply(L, doc);
  assert.strictEqual(doc.wrap.hidden, false);
  assert.strictEqual(doc.documentElement.lang, "fr");
  assert.strictEqual(doc.documentElement.dir, "ltr");
  assert.strictEqual(doc.sel.value, "fr");
  assert.strictEqual(doc.draft.hidden, false);
  assert.strictEqual(doc.all[0].textContent, "Et si ?");
  assert.strictEqual(L.locale(), "fr-FR");
  for (const key of keys) {
    assert.ok(catalog.strings[key].fr.trim(), key);
    assert.deepStrictEqual(placeholders(catalog.strings[key].fr), placeholders(catalog.strings[key][def]), key);
  }
  I18n.apply(I18n.create(catalog), doc);
  assert.strictEqual(doc.documentElement.lang, def);
  assert.strictEqual(doc.documentElement.dir, catalog.languages[def].dir);
  assert.strictEqual(doc.draft.hidden, true);
});
