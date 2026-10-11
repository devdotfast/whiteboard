const PADDING = 28;

// Bound export size independently of the visible workbench, including padding.
const MAX_CAPTURE_DIMENSION = 2048;

/** Prepare the drawing for the separate capture page without mounting it. */
export function prepareDiagramCapture(figure: HTMLElement) {
  const document = figure.ownerDocument;
  const surface = figure.querySelector<HTMLElement>(".react-flow");
  const tree = figure.querySelector<HTMLElement>('nav[aria-label="Call tree"]');
  const source = surface ?? tree;

  if (!source) throw new Error("Diagram is not ready to copy.");

  const bounds = surface
    ? graphBounds(surface)
    : {
        x: 0,
        y: 0,
        width: Math.max(
          source.scrollWidth,
          source.getBoundingClientRect().width,
        ),
        height: Math.max(
          source.scrollHeight,
          source.getBoundingClientRect().height,
        ),
      };

  if (
    !Number.isFinite(bounds.width) ||
    bounds.width <= 0 ||
    !Number.isFinite(bounds.height) ||
    bounds.height <= 0
  )
    throw new Error("Diagram layout is not ready.");

  const scale = Math.min(
    1,
    (MAX_CAPTURE_DIMENSION - PADDING * 2) / bounds.width,
    (MAX_CAPTURE_DIMENSION - PADDING * 2) / bounds.height,
  );

  const width = Math.ceil(bounds.width * scale + PADDING * 2);
  const height = Math.ceil(bounds.height * scale + PADDING * 2);
  const background = themeBackground(figure, source);
  const panel = document.createElement("div");
  panel.setAttribute("data-diagram-native-capture", "");
  panel.style.cssText = `position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;display:block;max-width:none;max-height:none;width:${width}px;height:${height}px;overflow:hidden;background:${background};color:inherit`;

  // Keep the figure's selector context, inline variables, and generated content.
  // No per-element computed-style reads or assignments are required.
  // SAFETY: Cloning an HTMLElement preserves its element type.
  const clone = figure.cloneNode(true) as HTMLElement;

  const content = clone.querySelector<HTMLElement>(
    surface ? ".react-flow" : 'nav[aria-label="Call tree"]',
  )!;

  // Keep only the chosen content and its ancestor chain inside the figure.
  for (let child: HTMLElement = content; child !== clone; ) {
    const parent = child.parentElement!;

    for (const sibling of Array.from(parent.children)) {
      if (sibling !== child) sibling.remove();
    }

    child = parent;
  }

  for (
    let element: HTMLElement | null = content;
    element;
    element = element.parentElement
  ) {
    for (const [property, value] of Object.entries({
      position: "relative",
      inset: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      width: `${width}px`,
      height: `${height}px`,
      "min-width": "0",
      "min-height": "0",
      "max-width": "none",
      "max-height": "none",
      overflow: "visible",
      transform: "none",
      display: "block",
      "box-sizing": "border-box",
      "box-shadow": "none",
      "border-radius": "0",
    }))
      element.style.setProperty(property, value, "important");

    if (element === clone) break;
  }

  if (surface) {
    const viewport = content.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );

    if (!viewport) throw new Error("Diagram layout is not ready.");
    viewport.style.setProperty(
      "transform",
      `translate(${PADDING - bounds.x * scale}px, ${PADDING - bounds.y * scale}px) scale(${scale})`,
      "important",
    );
    viewport.style.setProperty("transform-origin", "0 0", "important");
    viewport.style.setProperty("inset", "0", "important");
    content
      .querySelectorAll(".react-flow__panel")
      .forEach((element) => element.remove());
  } else {
    content.style.setProperty("width", `${bounds.width}px`, "important");
    content.style.setProperty("height", `${bounds.height}px`, "important");
    content.style.setProperty(
      "transform",
      `translate(${PADDING}px, ${PADDING}px) scale(${scale})`,
      "important",
    );
    content.style.setProperty("transform-origin", "0 0", "important");
  }

  const styles = document.createElement("style");
  styles.textContent = `
    [data-diagram-native-capture] *,
    [data-diagram-native-capture] *::before,
    [data-diagram-native-capture] *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }
    [data-diagram-native-capture] [data-motion] {
      opacity: 1 !important;
      stroke-dashoffset: 0 !important;
    }
    [data-diagram-native-capture] svg { overflow: visible !important; }
  `;
  panel.append(styles, clone);

  return { panel, width, height, background };
}

type Bounds = { x: number; y: number; width: number; height: number };

function include(bounds: Bounds | null, next: Bounds): Bounds {
  if (!bounds) return next;
  const x = Math.min(bounds.x, next.x);
  const y = Math.min(bounds.y, next.y);
  const right = Math.max(bounds.x + bounds.width, next.x + next.width);
  const bottom = Math.max(bounds.y + bounds.height, next.y + next.height);

  return { x, y, width: right - x, height: bottom - y };
}

function graphBounds(surface: HTMLElement): Bounds {
  const renderer = surface.querySelector<HTMLElement>(".react-flow__renderer");
  const viewport = surface.querySelector<HTMLElement>(".react-flow__viewport");

  if (!renderer || !viewport) throw new Error("Diagram layout is not ready.");

  const origin = renderer.getBoundingClientRect();
  const transform = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
  const zoom = transform.a;
  let bounds: Bounds | null = null;

  const addScreenRect = (element: Element) => {
    const rect = element.getBoundingClientRect();

    if (!rect.width && !rect.height) return;
    bounds = include(bounds, {
      x: (rect.left - origin.left - transform.e) / zoom,
      y: (rect.top - origin.top - transform.f) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    });
  };

  // Measure nodes, paths, and both HTML and SVG labels in the same coordinates.
  surface
    .querySelectorAll(
      ".react-flow__node, .react-flow__edgelabel-renderer > *, .react-flow__edge-path, .react-flow__edge-text, .react-flow__edges text",
    )
    .forEach(addScreenRect);

  if (!bounds) throw new Error("Diagram layout is not ready.");

  return bounds;
}

function themeBackground(figure: HTMLElement, content: HTMLElement): string {
  const canvas = getComputedStyle(content).backgroundColor;

  if (canvas.startsWith("rgb(") || /,\s*1\)$/.test(canvas)) return canvas;
  const style = getComputedStyle(figure);

  if (style.backgroundColor.startsWith("rgb(")) return style.backgroundColor;
  const surface = style.getPropertyValue("--surface").trim();

  if (surface) return surface;

  return getComputedStyle(figure.ownerDocument.body).backgroundColor || "#fff";
}
