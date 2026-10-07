// Plain Node and yauzl only: apps/review-desktop/scripts imports this file directly.
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import yauzl from "yauzl";
import { z } from "zod";

const manifestSchema = z.looseObject({
  publisher: z.string(),
  name: z.string(),
  engines: z.looseObject({ vscode: z.string().optional() }).optional(),
});

/** Unpacks a VSIX's `extension/` payload into `destination`. */
export async function extractVsix(
  vsix: string,
  destination: string,
  maxBytes = Number.POSITIVE_INFINITY,
) {
  let unpacked = 0;

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(vsix, { lazyEntries: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  );

  const openReadStream = (entry: yauzl.Entry) =>
    new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(entry, (error, stream) =>
        error ? reject(error) : resolve(stream),
      ),
    );

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          const name = entry.fileName.replaceAll("\\", "/");

          if (name.endsWith("/") || !name.startsWith("extension/")) return;

          const relative = name.slice("extension/".length);
          const parts = relative.split("/");
          const mode = (entry.externalFileAttributes >>> 16) & 0o177777;

          if (
            parts.some(
              (part) =>
                part === ".." ||
                part === "." ||
                part === "" ||
                part.includes(":"),
            ) ||
            path.posix.isAbsolute(relative)
          )
            throw new Error(`VSIX contains an unsafe path: ${name}`);

          if ((mode & 0o170000) === 0o120000)
            throw new Error(`VSIX contains a symlink: ${name}`);

          unpacked += entry.uncompressedSize;

          if (unpacked > maxBytes)
            throw new Error(`VSIX unpacks to more than ${maxBytes} bytes`);

          const output = path.join(destination, ...parts);
          await mkdir(path.dirname(output), { recursive: true });
          await pipeline(
            await openReadStream(entry),
            createWriteStream(output),
          );

          if (process.platform !== "win32" && mode & 0o111)
            await chmod(output, mode & 0o777);
        })().then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/**
 * Drops the `scripts` and `dependencies` a payload ships prebundled, and
 * `extensionPack` when Review does not ship the pack's members.
 */
export async function sanitizeVsixManifest(
  directory: string,
  extension: { id: string; stripExtensionPack: boolean },
) {
  const file = path.join(directory, "package.json");

  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );

  const declared = `${manifest.publisher}.${manifest.name}`;

  if (declared.toLowerCase() !== extension.id.toLowerCase())
    throw new Error(`${extension.id}: the VSIX declares ${declared}`);

  const { scripts, dependencies, devDependencies, extensionPack, ...kept } =
    manifest;

  await writeFile(
    file,
    `${JSON.stringify(
      extension.stripExtensionPack ? kept : { ...kept, extensionPack },
      undefined,
      2,
    )}\n`,
  );

  return manifest.engines?.vscode;
}
