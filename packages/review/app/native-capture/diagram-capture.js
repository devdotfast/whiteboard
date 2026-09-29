// This page is loaded only in a hidden, sandboxed BrowserWindow. Diagram markup
// is data; only this bundled script executes. Keep the CSP in the HTML intact.
window.renderDiagramCapture = async (snapshot) => {
  const parsed = new DOMParser().parseFromString(snapshot.html, "text/html");
  parsed
    .querySelectorAll("script, iframe, object, embed, base, meta, link")
    .forEach((node) => node.remove());

  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        ["srcdoc", "autofocus"].includes(attribute.name)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const [target, source] of [
    [document.documentElement, parsed.documentElement],
    [document.body, parsed.body],
  ]) {
    for (const attribute of source.attributes)
      target.setAttribute(attribute.name, attribute.value);
  }

  document.body.replaceChildren(...parsed.body.childNodes);

  const loading = [];

  for (const style of snapshot.styles) {
    const node = document.createElement("href" in style ? "link" : "style");

    if ("href" in style) {
      const url = new URL(style.href, location.href);

      if (
        url.origin !== location.origin ||
        url.protocol !== location.protocol
      ) {
        throw new Error("Capture stylesheet must be a bundled app resource.");
      }

      node.rel = "stylesheet";
      node.href = url.href;
      loading.push(
        new Promise((resolve, reject) => {
          node.onload = resolve;
          node.onerror = () =>
            reject(new Error("Could not load capture stylesheet."));
        }),
      );
    } else {
      node.textContent = style.css;
    }

    document.head.appendChild(node);
  }

  const reset = document.createElement("style");
  reset.textContent = `
    [data-diagram-capture-context] {
      position: static !important; inset: auto !important;
      display: block !important; visibility: visible !important; opacity: 1 !important;
      width: 100% !important; height: 100% !important;
      min-width: 0 !important; min-height: 0 !important;
      max-width: none !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important;
      transform: none !important; filter: none !important; perspective: none !important;
      contain: none !important; content-visibility: visible !important;
      overflow: visible !important; box-shadow: none !important;
    }
    html, body { overflow: hidden !important; }
    [data-diagram-capture-context]::before,
    [data-diagram-capture-context]::after { content: none !important; }
  `;
  document.head.appendChild(reset);
  document.body.style.setProperty(
    "background",
    snapshot.background,
    "important",
  );
  await Promise.all(loading);
  // Force layout so used fonts enter the loading set before awaiting readiness.
  document.body.getBoundingClientRect();
  await document.fonts.ready;
  await Promise.all(Array.from(document.images, (image) => image.decode()));
  await new Promise((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    ),
  );
};
