import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

/** The search index, exported as a static file at build time (no server in production). */
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
