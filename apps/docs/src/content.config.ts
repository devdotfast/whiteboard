import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  policies: defineCollection({
    loader: glob({ pattern: "{privacy,telemetry}.md", base: "../../docs" }),
  }),
};
