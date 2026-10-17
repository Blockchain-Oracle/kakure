import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

/** The docs live in content/docs; ```mermaid code blocks become <Mermaid> diagrams. */
export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
  },
});
