import data from "../../docs/data/funds.json";
import { createHandler } from "./handler.js";

export default {
  async fetch(request, env) {
    return createHandler({ data, ai: env.AI, gemini: env.GEMINI_API_KEY || null, caps: env.CAPS || null })(request);
  },
};
