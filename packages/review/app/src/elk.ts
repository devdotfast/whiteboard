import type { ELK } from "elkjs/lib/elk.bundled.js";

let elk: Promise<ELK> | undefined;

/** ELK is about half the canvas bundle, so it loads on the first layout. */
export function loadElk(): Promise<ELK> {
  elk ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: Elk }) => new Elk(),
  );

  return elk;
}
