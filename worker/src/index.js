import data from "../../docs/data/funds.json";
import { createHandler } from "./handler.js";

export default {
  async fetch(request, env) {
    return createHandler({ data, ai: env.AI })(request);
  },
};
