/* Free-text story helper: builds a prompt for any AI chat, and turns the JSON it returns into a timeline.
 * Pure functions (browser global StoryPrompt, or require() in tests). Nothing is sent anywhere. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StoryPrompt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var INSTRUCTIONS = [
    "You convert a free-text description of an Israeli pension / gemel / insurance savings story into JSON for a what-if calculator.",
    "Reply with ONLY one JSON object, no text around it, no code fence.",
    "Shape: {\"end\":\"YYYY-MM-DD\" (optional), \"events\":[...]}.",
    "The first event must be {\"type\":\"start\",\"date\":\"YYYY-MM-DD\",\"fundName\":\"<fund or track name as written>\",\"amount\":<opening amount, optional>}.",
    "Other events: {\"type\":\"deposit\",\"date\",\"amount\"}, {\"type\":\"monthly\",\"from\",\"to\"(optional),\"amount\"}, {\"type\":\"withdraw\",\"date\",\"amount\"},",
    "{\"type\":\"transfer\"|\"product\"|\"track\",\"date\",\"fundName\",\"exitCostPct\"(optional),\"feeAdjPct\"(optional)},",
    "{\"type\":\"fees\",\"date\",\"depositPct\"(optional),\"savingsPct\"(optional, yearly)}.",
    "transfer = move to another fund, product = move to another product (e.g. managers insurance to gemel), track = change investment track.",
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
    if (a < 0 || b <= a) throw new Error("לא נמצא JSON בתשובה");
    return JSON.parse(s.slice(a, b + 1));
  }

  /**
   * Replace fundName with a fundKey using searchFn(name) -> array of {key,name}. Returns {story, resolved, missing}.
   * The best match is used; the caller shows it so the person can correct it.
   */
  function resolveFunds(story, searchFn) {
    var resolved = [];
    var missing = [];
    var events = (story.events || []).map(function (e) {
      var copy = Object.assign({}, e);
      if (copy.fundName && !copy.fundKey) {
        var hits = searchFn(copy.fundName) || [];
        if (hits.length) {
          copy.fundKey = hits[0].key;
          resolved.push({ asked: copy.fundName, got: hits[0].name, key: hits[0].key });
        } else missing.push(copy.fundName);
      }
      delete copy.fundName;
      return copy;
    });
    return { story: Object.assign({}, story, { events: events }), resolved: resolved, missing: missing };
  }

  return { buildPrompt: buildPrompt, extractJson: extractJson, resolveFunds: resolveFunds };
});
