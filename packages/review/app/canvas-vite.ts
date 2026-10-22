import { createRequire } from "node:module";
import path from "node:path";

import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import type { AliasOptions, PluginOption } from "vite";

import { sourceAliases } from "../test-config";
import { scopeReviewCanvasCss } from "./desktop-css-scope";
import {
  hardenLibavoidForTrustedTypes,
  isLibavoidBrowserModule,
} from "./desktop-trusted-types";
import { stylexOptions } from "./stylex-options";

const require = createRequire(import.meta.url);

const decodeNamedCharacterReferenceIndex = path.join(
  path.dirname(require.resolve("decode-named-character-reference")),
  "index.js",
);

export function canvasPlugins(): PluginOption[] {
  return [
    // Appends the collected StyleX rules to the canvas CSS asset in its own
    // generateBundle, which runs before the scoping plugin below.
    stylex.vite(stylexOptions),
    {
      name: "harden-libavoid-trusted-types",
      enforce: "pre",
      transform(source, moduleId) {
        if (!isLibavoidBrowserModule(moduleId)) return;

        return {
          code: hardenLibavoidForTrustedTypes(source),
          map: null,
        };
      },
    },
    {
      // Chromium reads woff2; drop KaTeX's woff and ttf fallbacks.
      name: "katex-woff2-only",
      enforce: "pre",
      transform(source, moduleId) {
        if (!/[/\\]katex[/\\]dist[/\\]katex\.css$/.test(moduleId)) return;

        return {
          code: source.replaceAll(
            /, url\([^)]+\) format\("(?:woff|truetype)"\)/g,
            "",
          ),
          map: null,
        };
      },
    },
    react(),
    {
      name: "scope-review-canvas-css",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset" || !output.fileName.endsWith(".css")) {
            continue;
          }

          const source =
            output.source instanceof Uint8Array
              ? new TextDecoder().decode(output.source)
              : output.source;

          output.source = scopeReviewCanvasCss(source);
        }
      },
    },
  ];
}

export const canvasAliases: AliasOptions = {
  ...sourceAliases,
  "decode-named-character-reference": decodeNamedCharacterReferenceIndex,
};
