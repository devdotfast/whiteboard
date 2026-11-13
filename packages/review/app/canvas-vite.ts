import { createRequire } from "node:module";
import path from "node:path";

import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import type { AliasOptions, PluginOption } from "vite";

import { documentSource, sourceAliases } from "../test-config";
import { scopeReviewCanvasCss } from "./desktop-css-scope";
import {
  hardenLibavoidForTrustedTypes,
  isLibavoidBrowserModule,
} from "./desktop-trusted-types";
import { stylexOptions } from "./stylex-options";

const require = createRequire(import.meta.url);

// The animation stage runs anime.js's UMD build, which the package does not
// export; the stage imports it as text from here.
const animeBundles = path.join(
  path.dirname(require.resolve("animejs/package.json")),
  "dist/bundles",
);

// A diagram's stage runs ELK, d3 and Observable Plot from their browser
// builds, sent as text when a script first lays out or charts.
export const diagramLibraries = {
  "@elk-bundles": path.join(
    path.dirname(require.resolve("elkjs/package.json")),
    "lib",
  ),
  "@d3-bundles": path.join(
    // The package exports no package.json: step up from its entry.
    path.dirname(require.resolve("d3")),
    "../dist",
  ),
  "@three-bundles": path.join(
    // The package exports no package.json: step up from its entry.
    path.dirname(require.resolve("three")),
    "../build",
  ),
  "@plot-bundles": path.join(
    // The package exports no package.json: step up from its entry.
    path.dirname(require.resolve("@observablehq/plot")),
    "../dist",
  ),
};

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

export const canvasAliases = {
  ...sourceAliases,
  "@dev.fast/whiteboard-document": documentSource,
  "decode-named-character-reference": decodeNamedCharacterReferenceIndex,
  "@animejs-bundles": animeBundles,
  ...diagramLibraries,
} satisfies AliasOptions;
