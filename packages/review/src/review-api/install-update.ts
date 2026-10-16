import { existsSync } from "node:fs";
import path from "node:path";
import type { Writable } from "node:stream";

import { readBuildCommit } from "@review/package-paths.js";

/** Exits once an update replaces this install, or the Windows updater marks it. */
export function exitOnInstallUpdate(stderr: Writable): void {
  const commit = readBuildCommit(import.meta.url);

  if (!commit) return;

  const marker = path.join(path.dirname(process.execPath), "applying_update");
  const staleMarker = existsSync(marker);

  const timer = setInterval(() => {
    if (
      (!staleMarker && existsSync(marker)) ||
      readBuildCommit(import.meta.url) !== commit
    ) {
      clearInterval(timer);
      stderr.write("Whiteboard was updated. Restart its MCP server.\n", () =>
        process.exit(75),
      );
    }
  }, 1000).unref();
}
