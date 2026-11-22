import data from "../../docs/data/funds.json";
import pension from "../../docs/data/pension.json";
import catalog from "../../docs/i18n/strings.json";
import { createHandler } from "./handler.js";

export default {
  async fetch(request, env) {
    return createHandler({ data: { ...data, funds: data.funds.concat(pension) }, catalog, ai: env.AI, gemini: env.GEMINI_API_KEY || null, caps: env.CAPS || null })(request);
  },
};
