import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const developmentTestPackages = new Set([
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/sdk",
  "@pinojs/redact",
  "call-bind-apply-helpers",
  "call-bound",
  "dunder-proto",
  "es-define-property",
  "es-errors",
  "es-object-atoms",
  "fast-uri",
  "function-bind",
  "get-intrinsic",
  "get-proto",
  "gopd",
  "has-symbols",
  "isexe",
  "json-schema-traverse",
  "math-intrinsics",
  "object-inspect",
  "on-exit-leak-free",
  "pi-acp",
  "pino",
  "pino-abstract-transport",
  "pino-std-serializers",
  "process-warning",
  "qs",
  "quick-format-unescaped",
  "setprototypeof",
  "side-channel",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
  "sonic-boom",
  "thread-stream",
  "zod",
]);

export async function pruneReviewRuntime(root) {
  const removedBytes = {};

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }

      if (!entry.isFile()) continue;
      const relative = path.relative(root, file).split(path.sep).join("/");
      const parts = relative.split("/");

      if (
        entry.name.endsWith(".map") ||
        /^(license|notice|copying)/i.test(entry.name)
      )
        continue;
      const packageParts = parts.slice(parts.lastIndexOf("node_modules") + 1);

      const packageName = packageParts[0].startsWith("@")
        ? packageParts.slice(0, 2).join("/")
        : packageParts[0];

      let category;

      if (relative.startsWith("src/")) category = "own-source";
      else if (relative.startsWith("node_modules/")) {
        if (parts.some((part) => part === "sharp" || part.startsWith("sharp-")))
          continue;

        if (/\.d\.(ts|cts|mts)$/.test(entry.name)) category = "declarations";
        else if (
          developmentTestPackages.has(packageName) &&
          (parts.some((part) =>
            ["test", "tests", "__tests__", "__fixtures__", "fixtures"].includes(
              part,
            ),
          ) ||
            /\.test\./.test(entry.name))
        )
          category = "tests";
        else if (relative.includes("/zod/src/")) category = "zod-source";
        else if (
          relative.startsWith(
            "node_modules/@modelcontextprotocol/sdk/dist/cjs/",
          )
        )
          category = "mcp-cjs";
        else if (relative.startsWith("node_modules/hono/dist/cjs/"))
          category = "hono-cjs";
      }

      if (!category) continue;
      const { size } = await lstat(file);
      await unlink(file);
      removedBytes[category] = (removedBytes[category] ?? 0) + size;
    }
  }

  await visit(root);

  return removedBytes;
}
