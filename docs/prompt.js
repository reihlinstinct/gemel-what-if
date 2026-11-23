/* Free-text story helper: builds a prompt for any AI chat, and turns the JSON it returns into a timeline.
 * Pure functions (browser global StoryPrompt, or require() in tests). Nothing is sent anywhere. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./whatif.js"));
  else root.StoryPrompt = factory(root.WhatIf);
})(typeof self !== "undefined" ? self : this, function (W) {
  "use strict";

  var INSTRUCTIONS = [
    "You convert a free-text description of an Israeli pension / gemel / insurance savings story into JSON for a what-if calculator.",
    "Reply with ONLY one JSON object, no text around it, no code fence.",
    "Shape: {\"end\":\"YYYY-MM-DD\" (optional), \"events\":[...]}.",
    "The first event must be {\"type\":\"start\",\"date\":\"YYYY-MM-DD\",\"fundName\":\"<fund or track name as written>\",\"amount\":<opening amount, optional>}; it may also carry \"feeAdjPct\" (yearly savings fee) and \"depositFeePct\".",
    "Other events: {\"type\":\"deposit\",\"date\",\"amount\"}, {\"type\":\"monthly\",\"from\",\"to\"(optional),\"amount\"}, {\"type\":\"withdraw\",\"date\",\"amount\"},",
    "{\"type\":\"transfer\"|\"product\"|\"track\",\"date\",\"fundName\",\"exitCostPct\"(optional),\"feeAdjPct\"(optional),\"depositFeePct\"(optional)},",
    "{\"type\":\"fees\",\"date\",\"depositPct\"(optional),\"savingsPct\"(optional, yearly)}.",
    "transfer = move to another fund, product = move to another product (e.g. managers insurance to gemel), track = change investment track.",
    "To compare two scenarios, describe them with scope: events shared by both have no scope (or \"both\"); what really happened differs with \"actual\", the alternative (\"what if\") with \"whatif\". There is exactly one start event, always shared. A what-if move to another fund is a \"product\"/\"transfer\"/\"track\" event with scope \"whatif\"; an actual move gets scope \"actual\".",
    "Any event may have \"scope\":\"actual\" (what really happened), \"whatif\" (the alternative to compare) or \"both\" (default).",
    "Use fundName exactly as the person wrote it (company and track, e.g. \"Clal managers insurance\"); never invent ids. Amounts are in shekels.",
    "Dates are YYYY-MM-DD; if the day is unknown use the 1st. Do not invent facts: leave out what the text does not say.",
  ].join("\n");

  function buildPrompt(text) {
    return INSTRUCTIONS + "\n\nStory:\n" + String(text || "").trim();
  }

  /** Pull the first JSON object out of an AI reply (tolerates code fences and surrounding text). */
  function extractJson(reply) {
    var s = String(reply || "");
    var fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
    if (fence) s = fence[1];
    var a = s.indexOf("{");
    var b = s.lastIndexOf("}");
    if (a < 0 || b <= a) {
      // The page shows the catalog text for i18nKey. The message itself is also model-facing feedback in
      // the Worker's retry loop, so it stays word for word (tests/i18n.test.js pins it to the catalog).
      var err = new Error("לא נמצא JSON בתשובה");
      err.i18nKey = "prompt.no_json";
      throw err;
    }
    return JSON.parse(s.slice(a, b + 1));
  }

  /**
   * Replace fundName with a fundKey using searchFn(name) -> array of {key,name}. Returns {story, resolved, missing}.
   * Only a unique match is used. Ambiguous names remain unselected for the person to resolve.
   */
  function resolveFunds(story, searchFn) {
    var resolved = [];
    var missing = [];
    var events = (story.events || []).map(function (e) {
      var copy = Object.assign({}, e);
      if (copy.fundName && !copy.fundKey) {
        var hits = searchFn(copy.fundName) || [];
        if (hits.length === 1) {
          copy.fundKey = hits[0].key;
          resolved.push({ asked: copy.fundName, got: hits[0].name, key: hits[0].key });
        } else missing.push(copy.fundName);
      }
      delete copy.fundName;
      return copy;
    });
    return { story: Object.assign({}, story, { events: events }), resolved: resolved, missing: missing };
  }

  function groundGenerated(story, text, funds) {
    if (!story || !Array.isArray(story.events)) throw new Error("Invalid timeline events");
    const original = W.canonicalName(text);
    const bounded = (value, allowPrefix) => {
      const needle = W.canonicalName(value);
      if (!needle) return false;
      let at = original.indexOf(needle);
      while (at >= 0) {
        const before = original[at-1] || " ";
        const prefix = allowPrefix && /[בל]/u.test(before) && !/[\p{L}\p{N}:]/u.test(original[at-2] || " ");
        if ((!/[\p{L}\p{N}:]/u.test(before) || prefix) && !/[\p{L}\p{N}:]/u.test(original[at+needle.length] || " ")) return true;
        at = original.indexOf(needle, at+1);
      }
      return false;
    };
    return Object.assign({}, story, {events:story.events.map(e => {
      if (!e || typeof e !== "object") throw new Error("Invalid timeline event");
      const copy = Object.assign({}, e);
      if (copy.fundKey !== undefined) {
        const f = funds.get(copy.fundKey);
        const name = f && W.canonicalName(f.name);
        const unique = name && Array.from(funds.values()).filter(other => W.canonicalName(other.name) === name).length === 1;
        if (typeof copy.fundKey !== "string" || !bounded(copy.fundKey, false) && !(unique && bounded(f.name, true))) delete copy.fundKey;
      }
      if (copy.fundName && (typeof copy.fundName !== "string" || !bounded(copy.fundName, true))) delete copy.fundName;
      return copy;
    })});
  }

  return { buildPrompt: buildPrompt, extractJson: extractJson, resolveFunds: resolveFunds, groundGenerated: groundGenerated };
});
