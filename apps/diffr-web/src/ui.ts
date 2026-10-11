/** The page's own controls: plain elements styled by styles.css. */

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

export function actionButton(
  label: string,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const button = element(
    "button",
    primary ? "app-button primary" : "app-button",
    label,
  );

  button.type = "button";
  button.addEventListener("click", onClick);

  return button;
}

/** A modal over `parent`, removed once closed. */
export function dialog(
  parent: HTMLElement,
  title: string,
  build: (dialog: HTMLDialogElement, actions: HTMLElement) => void,
  className?: string,
): HTMLDialogElement {
  const node = parent.appendChild(
    element("dialog", className ? `app-dialog ${className}` : "app-dialog"),
  );

  node.appendChild(element("h2", undefined, title));
  const actions = element("div", "app-dialog-actions");
  build(node, actions);
  node.appendChild(actions);
  node.addEventListener("close", () => node.remove());
  node.showModal();

  return node;
}

/** A labelled field: its label, the control, and a hint under it. */
export function field<T extends HTMLElement>(
  parent: HTMLElement,
  label: string,
  control: T,
  hint?: string | Node,
): T {
  const wrapper = parent.appendChild(element("label", "app-field"));
  wrapper.appendChild(element("span", "app-field-label", label));
  wrapper.appendChild(control);

  if (hint !== undefined) {
    const note = wrapper.appendChild(element("span", "app-field-hint"));
    note.append(hint);
  }

  return control;
}

/** A link that opens in a new tab. */
export function link(href: string, text: string): HTMLAnchorElement {
  const anchor = element("a", undefined, text);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";

  return anchor;
}

/** Text with links and code spans, from a template: `[label](url)` and `` `code` ``. */
export function rich(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let at = 0;

  for (const match of text.matchAll(pattern)) {
    fragment.append(text.slice(at, match.index));

    if (match[1] !== undefined) fragment.appendChild(link(match[2]!, match[1]));
    else fragment.appendChild(element("code", undefined, match[3]));
    at = match.index + match[0].length;
  }

  fragment.append(text.slice(at));

  return fragment;
}
