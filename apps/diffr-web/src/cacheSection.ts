/** The settings' account of what this browser keeps (cache.ts), and a button to drop it. */
import {
  cacheUsage,
  clearCache,
  loadCacheUsage,
  onCacheChange,
} from "./cache.js";
import { actionButton, element } from "./ui.js";

export const megabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function cacheSection(parent: HTMLElement): void {
  const section = parent.appendChild(element("section"));
  section.appendChild(element("h3", undefined, "Cache"));
  section.appendChild(
    element(
      "p",
      undefined,
      "diffr keeps each file's diff and summaries in this browser, so opening a comparison again shows them without fetching, diffing or asking the model again. Past 512 MB, the results read longest ago go first.",
    ),
  );
  const row = section.appendChild(element("div", "app-cache"));
  const usage = row.appendChild(element("span"));
  row.appendChild(element("span", "app-spacer"));

  const clear = row.appendChild(
    actionButton("Clear cache", () => {
      clear.disabled = true;
      void clearCache().finally(() => (clear.disabled = false));
    }),
  );

  const render = () => {
    if (!usage.isConnected) return stop();
    const { entries, bytes } = cacheUsage();
    usage.textContent = `${entries.toLocaleString("en")} result${entries === 1 ? "" : "s"}, ${megabytes(bytes)}`;
    clear.disabled = !entries;
  };

  const stop = onCacheChange(render);
  loadCacheUsage();
  render();
}
