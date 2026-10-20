import { docs } from "fumadocs-mdx:collections/server";
import { loader } from "fumadocs-core/source";

/** Pages at the site root: docs.getkakure.xyz/first-trade, not /docs/first-trade. */
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
