/* Translations. docs/i18n/strings.json is the only source of languages and UI text: one block per
 * language under "languages" (code, own name, direction, locale, machine-draft status) and one value
 * per language for every key under "strings". Nothing else lists languages; the picker, <html lang dir>,
 * number formatting and og:locale are all derived from the catalog. Pure helpers plus a small DOM
 * applier (browser global I18n, or require() in Node tests and the Worker). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.I18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Bind the helpers to one catalog. lang defaults to the catalog's default language. */
  function create(catalog, lang) {
    var langs = (catalog && catalog.languages) || {};
    var strings = (catalog && catalog.strings) || {};
    var codes = Object.keys(langs);
    var def = codes.filter(function (c) { return langs[c].default; })[0] || codes[0];
    var cur = lang && langs[lang] ? lang : def;

    /** "{name}" placeholders; a param that is passed is always substituted (String(value)). */
    function fill(template, params) {
      return template.replace(/\{(\w+)\}/g, function (m, name) {
        return params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
      });
    }
    function t(key, params, as) {
      var entry = strings[key];
      if (!entry) return key;
      var template = entry[as || cur];
      if (template === undefined || template === null) template = entry[def];
      return template === undefined || template === null ? key : fill(template, params);
    }
    return {
      t: t,
      has: function (key) { return Object.prototype.hasOwnProperty.call(strings, key); },
      lang: function () { return cur; },
      defaultLang: function () { return def; },
      languages: function () { return codes.slice(); },
      meta: function (code) { return langs[code || cur]; },
      /** Picker options: exactly the catalog languages, in catalog order, each by its own name. */
      pickerOptions: function () { return codes.map(function (c) { return { code: c, name: langs[c].name }; }); },
      locale: function () { return langs[cur].locale; },
    };
  }

  /** ?lang=<code> keeps the choice in the URL: shareable, no cookies, no storage. */
  function langFromSearch(catalog, search) {
    var q = null;
    var m = /(?:^\?|&)lang=([^&#]*)/.exec(search || "");
    if (m) q = decodeURIComponent(m[1]);
    return q && catalog.languages[q] ? q : null;
  }

  /**
   * Fill the page from the catalog: <html lang dir>, og:locale, [data-i18n] (text), [data-i18n-html]
   * (inline markup), [data-i18n-<attr>] for content / placeholder / aria-label, and the picker.
   * The default language's values equal the text baked into index.html (tests/i18n.test.js), so for it
   * this is a no-op and the page reads the same with or without JavaScript.
   */
  function apply(i18n, doc, onPick) {
    var meta = i18n.meta();
    doc.documentElement.lang = i18n.lang();
    doc.documentElement.dir = meta.dir;
    var og = doc.querySelector('meta[property="og:locale"]');
    if (og) og.setAttribute("content", meta.locale.replace("-", "_"));
    var each = function (sel, fn) { Array.prototype.forEach.call(doc.querySelectorAll(sel), fn); };
    each("[data-i18n]", function (el) { el.textContent = i18n.t(el.getAttribute("data-i18n")); });
    each("[data-i18n-html]", function (el) { el.innerHTML = i18n.t(el.getAttribute("data-i18n-html")); });
    ["content", "placeholder", "aria-label"].forEach(function (attr) {
      each("[data-i18n-" + attr + "]", function (el) { el.setAttribute(attr, i18n.t(el.getAttribute("data-i18n-" + attr))); });
    });
    var draft = doc.getElementById("translation-draft");
    if (draft) draft.hidden = meta.status !== "machine-draft";
    var sel = doc.getElementById("lang");
    if (!sel) return;
    var opts = i18n.pickerOptions();
    sel.innerHTML = "";
    opts.forEach(function (o) {
      var op = doc.createElement("option");
      op.value = o.code;
      op.textContent = o.name;
      op.lang = o.code;
      sel.appendChild(op);
    });
    sel.value = i18n.lang();
    // With a single language there is nothing to choose: the picker stays hidden.
    sel.closest(".lang-pick").hidden = opts.length < 2;
    if (onPick) sel.onchange = function () { onPick(sel.value); };
  }

  return { create: create, langFromSearch: langFromSearch, apply: apply };
});
