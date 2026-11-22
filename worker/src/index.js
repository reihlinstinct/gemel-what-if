import data from "../../docs/data/funds.json";
import pension from "../../docs/data/pension.json";
import catalog from "../../docs/i18n/strings.json";
import FundCatalog from "../../docs/catalog.js";
import { createHandler } from "./handler.js";

const assembledData = FundCatalog.assemble(data, pension);

export default {
  async fetch(request, env) {
    return createHandler({ data: assembledData, catalog, ai: env.AI, gemini: env.GEMINI_API_KEY || null, caps: env.CAPS || null })(request);
  },
};
