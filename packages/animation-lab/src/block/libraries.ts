/**
 * The libraries an animation's script may import, pinned and loaded from
 * esm.sh. React Flow takes React from the map, so the stage has one React.
 */
const CDN = "https://esm.sh";

export const importMap = {
  imports: {
    three: `${CDN}/three@0.186.1`,
    "three/": `${CDN}/three@0.186.1/`,
    animejs: `${CDN}/animejs@4.5.0`,
    react: `${CDN}/react@19.2.5`,
    "react/": `${CDN}/react@19.2.5/`,
    "react-dom": `${CDN}/react-dom@19.2.5`,
    "react-dom/": `${CDN}/react-dom@19.2.5/`,
    "@xyflow/react": `${CDN}/@xyflow/react@12.10.2?external=react,react-dom`,
    // Loaded by wb.layout() on first use; scripts may import it too.
    elkjs: `${CDN}/elkjs@0.11.1/lib/elk.bundled.js`,
    // Charts: wb.chart() loads it on first use; scripts may import it too.
    "@observablehq/plot": `${CDN}/@observablehq/plot@0.6.17`,
  },
};

export const stylesheets = [`${CDN}/@xyflow/react@12.10.2/dist/style.css`];

export const libraryOrigin = CDN;
