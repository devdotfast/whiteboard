import { installWb } from "../sdk/wb";
import { importMap, libraryOrigin, stylesheets } from "./libraries";
import type { StageState, Timeline } from "./model";

/** The iframe's document: the SDK first, then the model's script as a
 * module that may import the mapped libraries. Only the library CDN is
 * reachable. `inset` is the space in px between the stage's edge and the
 * drawing. */
export function stageDocument(
  script: string,
  initial: StageState,
  timeline: Timeline | null,
  inset: number,
) {
  // A script's text cannot hold `</script` or `<!--`, in any case, or the
  // tag ends early or never ends.
  const safe = (source: string) => source.replace(/<(\/script|!--)/gi, "<\\$1");

  // Data has no tags at all: `\u003c` reads back as `<` in JSON and JS.
  const tagless = (json: string) => json.replaceAll("<", "\\u003c");

  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${libraryOrigin}`,
    `style-src 'unsafe-inline' ${libraryOrigin}`,
    `img-src data: blob:`,
  ].join("; ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    ${stylesheets.map((href) => `<link rel="stylesheet" href="${href}" />`).join("\n    ")}
    <style>
      /* The inset keeps the drawing off the stage's edges. Stage coordinates
         start at the body's corner, which positioned children measure from. */
      html { box-sizing: border-box; height: 100%; padding: ${inset}px; background: transparent; }
      body { position: relative; margin: 0; height: 100%; background: transparent; }
    </style>
    <script type="importmap">${tagless(JSON.stringify(importMap))}</script>
  </head>
  <body>
    <script>(${safe(installWb.toString())})(${tagless(JSON.stringify(initial))}, ${tagless(JSON.stringify(timeline))});</script>
    <script type="module">window.wbLoadElk = () => import("elkjs"); window.wbLoadPlot = () => import("@observablehq/plot");</script>
    <script type="module">${safe(script)}</script>
  </body>
</html>`;
}
