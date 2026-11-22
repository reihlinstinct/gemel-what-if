/* Checked assembly of the public catalog. Shared by browser, MCP and Worker. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FundCatalog = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const month = x => Number.isInteger(x) && x >= 190001 && x <= 299912 && x % 100 >= 1 && x % 100 <= 12;
  const idx = x => Math.floor(x / 100) * 12 + x % 100;
  function assemble(base, pension) {
    if (!object(base) || !object(base.sources) || !month(base.latest) || !Array.isArray(base.funds) || !base.funds.length || !Array.isArray(pension)) throw new Error("Invalid catalog shape");
    if (base.sources.pension && !pension.length) throw new Error("Missing pension records");
    const keys = new Set();
    let latest = 0;
    for (const [rows, isPension] of [[base.funds, false], [pension, true]]) {
      for (const f of rows) {
        const prefix = { gemel: "g", insurance: "i", pension: "p" }[f && f.src];
        if (!object(f) || !prefix || (f.src === "pension") !== isPension || !Number.isInteger(f.id) || f.id <= 0 || f.key !== prefix + ":" + f.id || keys.has(f.key)) throw new Error("Invalid or duplicate fund key");
        if (typeof base.sources[f.src] !== "string" || typeof f.name !== "string" || !f.name.trim() || !month(f.start) || !month(f.end) || f.end < f.start || !Array.isArray(f.y) || f.y.length !== idx(f.end) - idx(f.start) + 1 || f.y.some(y => y !== null && (typeof y !== "number" || !Number.isFinite(y)))) throw new Error("Invalid fund series");
        keys.add(f.key);
        latest = Math.max(latest, f.end);
      }
    }
    if (latest !== base.latest) throw new Error("Catalog latest month disagrees with series");
    return { ...base, funds: base.funds.concat(pension) };
  }
  async function checked(fetcher, path) {
    const response = await fetcher(path, { cache: "no-cache" });
    if (!response.ok) throw new Error("Catalog HTTP " + response.status);
    const text = await response.text();
    return { text, value: JSON.parse(text) };
  }
  async function load(fetcher, subtle) {
    const { value: manifest } = await checked(fetcher, "data/catalog.json");
    if (!object(manifest) || manifest.version !== 1 || !object(manifest.sha256) || !/^[a-f0-9]{64}$/.test(manifest.sha256.funds) || !/^[a-f0-9]{64}$/.test(manifest.sha256.pension) || !Number.isInteger(manifest.count) || !month(manifest.latest)) throw new Error("Invalid catalog manifest");
    const parts = await Promise.all([checked(fetcher, "data/funds.json"), checked(fetcher, "data/pension.json")]);
    if (!subtle || typeof subtle.digest !== "function") throw new Error("Catalog digest verification unavailable");
    for (let i = 0; i < parts.length; i++) {
      const bytes = await subtle.digest("SHA-256", new TextEncoder().encode(parts[i].text));
      const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
      if (digest !== manifest.sha256[i ? "pension" : "funds"]) throw new Error("Catalog snapshot mismatch");
    }
    const data = assemble(parts[0].value, parts[1].value);
    if (data.funds.length !== manifest.count || data.latest !== manifest.latest) throw new Error("Catalog manifest disagrees with data");
    return data;
  }
  return { assemble, load };
});
