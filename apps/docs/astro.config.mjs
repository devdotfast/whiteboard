import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

import accessibleTables from "./src/plugins/accessible-tables";
import docsLinks from "./src/plugins/docs-links";

const base =
  `/${(process.env.DOCS_BASE || "").split("/").filter(Boolean).join("/")}/`.replace(
    /^\/\//,
    "/",
  );

export default defineConfig({
  site: process.env.DOCS_SITE,
  base,
  trailingSlash: "always",
  redirects: {
    "/start/installation/": `${base}installation/`,
    "/start/first-review/": `${base}guides/create-a-review/`,
    "/guides/read-a-review/": `${base}guides/create-a-review/#read-the-review`,
    "/guides/ask-agent/": `${base}guides/create-a-review/`,
  },
  // Astro's bundled prerenderer must not pick up an older hoisted cookie package.
  vite: {
    environments: { prerender: { resolve: { noExternal: ["cookie"] } } },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [[docsLinks, { base }]],
      rehypePlugins: [accessibleTables],
    }),
  },
  integrations: [
    starlight({
      title: "Whiteboard",
      description:
        "Install Whiteboard, connect your coding agent, and understand your first review.",
      logo: { src: "./src/assets/logo.svg", alt: "", replacesTitle: false },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      components: { Footer: "./src/components/Footer.astro" },
      editLink: {
        baseUrl:
          "https://github.com/devdotfast/whiteboard/edit/main/apps/docs/",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/devdotfast/whiteboard",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/wYvd2cpMQg",
        },
      ],
      markdown: { processedDirs: ["../../docs"] },
      sidebar: [
        {
          label: "Start Here",
          items: [
            { slug: "index", label: "Introduction" },
            "start/quick-start",
          ],
        },
        {
          label: "Use Whiteboard",
          items: [
            "installation",
            "agents",
            "guides/create-a-review",
            "help/troubleshooting",
          ],
        },
      ],
    }),
  ],
});
