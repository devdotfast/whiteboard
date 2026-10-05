import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";

import {
  jsonArray,
  jsonObject,
  jsonString,
  parseJsonText,
} from "@dev.fast/json";
import yauzl from "yauzl";
import { z } from "zod";

import { findReviewPackageRoot } from "./package-paths";
import { devReviewHome } from "./review-home-paths";

const DOWNLOAD_TIMEOUT_MS = 120_000;

const EXECUTABLE_TIMEOUT_MS = 15_000;

const STAMP_FILE = ".curated.json";

type RemoteTarget = "linux-x64" | "linux-arm64";

const curatedDownloadSchema = z.object({
  universal: z.boolean(),
  url: z.string(),
  sha256: z.string(),
  size: z.number(),
});

type CuratedDownload = z.infer<typeof curatedDownloadSchema>;

const curatedExtensionSchema = z.object({
  id: z.string(),
  version: z.string(),
  tier: z.enum(["bundled", "optional"]),
  group: z.string(),
  executables: z.array(z.string()),
  stripExtensionPack: z.boolean(),
  addActivationEvents: z.array(z.string()),
  targets: z.object({
    "linux-x64": curatedDownloadSchema,
    "linux-arm64": curatedDownloadSchema,
  }),
});

export type CuratedRemoteExtension = z.infer<typeof curatedExtensionSchema>;

const stampSchema = z.object({
  id: z.string(),
  version: z.string(),
  target: z.string(),
  sha256: z.string(),
  installedTimestamp: z.number(),
});

type Stamp = z.infer<typeof stampSchema>;

export function whiteboardRemoteHome(env: NodeJS.ProcessEnv = process.env) {
  return path.join(devReviewHome(env), "whiteboard-remote");
}

export function remoteServerPaths(env: NodeJS.ProcessEnv = process.env) {
  const home = whiteboardRemoteHome(env);

  return {
    extensionsDir: path.join(home, "extensions"),
    serverDataDir: path.join(home, "server"),
  };
}

export function remoteExtensionTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): RemoteTarget {
  if (platform === "linux" && (arch === "x64" || arch === "arm64"))
    return `linux-${arch}`;

  throw new Error(
    `Language features on a remote need Linux on x64 or arm64; this machine is ${platform}-${arch}.`,
  );
}

interface EnsureRemoteExtensionsInput {
  env?: NodeJS.ProcessEnv;
  curated?: CuratedRemoteExtension[];
  groups?: string[];
  target?: RemoteTarget;
  timeoutMs?: number;
}

export async function ensureRemoteExtensions(
  input: EnsureRemoteExtensionsInput = {},
) {
  const target = input.target ?? remoteExtensionTarget();
  const curated = input.curated ?? (await readPackagedCurated());
  const { extensionsDir, serverDataDir } = remoteServerPaths(input.env);
  const installed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; error: string }[] = [];
  const listed: StoredExtension[] = [];

  await mkdir(extensionsDir, { recursive: true });

  for (const extension of curated) {
    if (
      extension.tier === "optional" &&
      !input.groups?.includes(extension.group)
    ) {
      skipped.push({
        id: extension.id,
        reason: `optional group "${extension.group}" not requested`,
      });
      continue;
    }

    const download = extension.targets[target];
    const folder = `${extension.id}-${extension.version}`;
    const directory = path.join(extensionsDir, folder);

    const stamp = {
      id: extension.id,
      version: extension.version,
      target,
      sha256: download.sha256,
    };

    try {
      const current = await readStamp(directory);

      if (
        current &&
        sameStamp(current, stamp) &&
        (await checkExecutables(directory, extension).then(
          () => true,
          () => false,
        ))
      ) {
        skipped.push({ id: extension.id, reason: "up to date" });
        listed.push(
          storedExtension(
            extension,
            directory,
            folder,
            target,
            current.installedTimestamp,
          ),
        );
        continue;
      }

      const installedTimestamp = Date.now();
      await install(
        extension,
        download,
        directory,
        { ...stamp, installedTimestamp },
        input.timeoutMs,
      );
      installed.push(extension.id);
      listed.push(
        storedExtension(
          extension,
          directory,
          folder,
          target,
          installedTimestamp,
        ),
      );
    } catch (error) {
      failed.push({
        id: extension.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The scanner caches its last scan; a changed list is read only once the cache is gone.
  const list = `${JSON.stringify(listed)}\n`;
  const listFile = path.join(extensionsDir, "extensions.json");

  if ((await readFile(listFile, "utf8").catch(() => undefined)) !== list) {
    const temporary = `${listFile}.${process.pid}.tmp`;

    await writeFile(temporary, list);
    await rename(temporary, listFile);
    await rm(path.join(serverDataDir, "data", "CachedProfilesData"), {
      recursive: true,
      force: true,
    });
  }

  return {
    event: "remote.extensions" as const,
    target,
    installed,
    skipped,
    failed,
  };
}

async function readPackagedCurated(): Promise<CuratedRemoteExtension[]> {
  const file = path.join(
    findReviewPackageRoot(import.meta.url),
    "vscode-server",
    "curated.json",
  );

  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(`This package has no VS Code server (${file} is missing).`);
  });

  return z
    .object({ extensions: z.array(curatedExtensionSchema) })
    .parse(JSON.parse(text)).extensions;
}

async function readStamp(directory: string): Promise<Stamp | undefined> {
  return readFile(path.join(directory, STAMP_FILE), "utf8")
    .then((text) => stampSchema.safeParse(parseJsonText(text)).data)
    .catch(() => undefined);
}

function sameStamp(
  current: Stamp,
  expected: Omit<Stamp, "installedTimestamp">,
) {
  return (
    current.id === expected.id &&
    current.version === expected.version &&
    current.target === expected.target &&
    current.sha256 === expected.sha256
  );
}

async function install(
  extension: CuratedRemoteExtension,
  download: CuratedDownload,
  directory: string,
  stamp: Stamp,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
) {
  const part = `${directory}.${process.pid}.vsix`;
  const staging = `${directory}.${process.pid}.staging`;

  try {
    await fetchVerified(download, part, timeoutMs);
    await rm(staging, { recursive: true, force: true });
    await extractVsix(part, staging, download.size * 8);
    await sanitizeManifest(staging, extension);

    await checkExecutables(staging, extension);

    await writeFile(
      path.join(staging, STAMP_FILE),
      `${JSON.stringify(stamp)}\n`,
    );
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
  } finally {
    await rm(part, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

async function fetchVerified(
  download: CuratedDownload,
  file: string,
  timeoutMs: number,
) {
  const { host } = new URL(download.url);
  let response: Response;

  try {
    response = await fetch(download.url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `Network error reaching ${host}: ${error instanceof Error ? networkCause(error) : String(error)}`,
    );
  }

  if (!response.ok || !response.body)
    throw new Error(`${host} answered ${response.status} for ${download.url}`);

  const hash = createHash("sha256");
  let received = 0;

  const tooLarge = new Error(
    `${download.url} is larger than its pinned ${download.size} bytes`,
  );

  try {
    await pipeline(
      // SAFETY: Node's fetch body is its own web stream; the DOM type only
      // names the same object.
      Readable.fromWeb(response.body as WebReadableStream),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          received += chunk.length;

          if (received > download.size) throw tooLarge;

          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(file),
    );
  } catch (error) {
    if (error === tooLarge) throw error;

    throw new Error(
      `Network error downloading from ${host}: ${error instanceof Error ? networkCause(error) : String(error)}`,
    );
  }

  const actual = hash.digest("hex");

  if (actual !== download.sha256)
    throw new Error(
      `Checksum mismatch for ${download.url}: expected ${download.sha256}, got ${actual}. The download was deleted.`,
    );
}

const networkCauseSchema = z.object({ code: z.string() });

const networkCause = (error: Error) =>
  error.name === "TimeoutError"
    ? "timed out"
    : (networkCauseSchema.safeParse(error.cause).data?.code ?? error.message);

async function extractVsix(
  vsix: string,
  destination: string,
  maxBytes: number,
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
          const mode = (entry.externalFileAttributes >>> 16) & 0o177777;

          if (
            relative.split("/").some((part) => part === ".." || part === "") ||
            path.posix.isAbsolute(relative)
          )
            throw new Error(`VSIX contains an unsafe path: ${name}`);

          if ((mode & 0o170000) === 0o120000)
            throw new Error(`VSIX contains a symlink: ${name}`);

          unpacked += entry.uncompressedSize;

          if (unpacked > maxBytes)
            throw new Error(`VSIX unpacks to more than ${maxBytes} bytes`);

          const output = path.join(destination, ...relative.split("/"));
          await mkdir(path.dirname(output), { recursive: true });
          await pipeline(
            await openReadStream(entry),
            createWriteStream(output),
          );

          if (mode & 0o111) await chmod(output, mode & 0o777);
        })().then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function sanitizeManifest(
  directory: string,
  extension: CuratedRemoteExtension,
) {
  const file = path.join(directory, "package.json");

  const manifest = jsonObject(parseJsonText(await readFile(file, "utf8")));
  const declared = `${jsonString(manifest?.publisher)}.${jsonString(manifest?.name)}`;

  if (!manifest || declared.toLowerCase() !== extension.id)
    throw new Error(`${extension.id}: the VSIX declares ${declared}`);

  delete manifest.scripts;
  delete manifest.dependencies;
  delete manifest.devDependencies;

  if (extension.stripExtensionPack) delete manifest.extensionPack;

  const events = jsonArray(manifest.activationEvents) ?? [];

  for (const event of extension.addActivationEvents)
    if (!events.includes(event)) events.push(event);

  if (events.length > 0) manifest.activationEvents = events;

  await writeFile(file, `${JSON.stringify(manifest, undefined, 2)}\n`);
}

async function checkExecutables(
  directory: string,
  extension: CuratedRemoteExtension,
) {
  for (const relative of extension.executables) {
    await promisify(execFile)(path.join(directory, relative), ["--version"], {
      timeout: EXECUTABLE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    }).catch((error: Error) => {
      throw new Error(
        `${extension.id}: ${relative} does not run here: ${error.message}`,
      );
    });
  }
}

interface StoredExtension {
  identifier: { id: string };
  version: string;
  location: { $mid: 1; scheme: "file"; path: string };
  relativeLocation: string;
  metadata: { installedTimestamp: number; targetPlatform: string };
}

function storedExtension(
  extension: CuratedRemoteExtension,
  directory: string,
  folder: string,
  target: RemoteTarget,
  installedTimestamp: number,
): StoredExtension {
  return {
    identifier: { id: extension.id },
    version: extension.version,
    location: { $mid: 1, scheme: "file", path: directory },
    relativeLocation: folder,
    metadata: {
      installedTimestamp,
      targetPlatform: extension.targets[target].universal
        ? "universal"
        : target,
    },
  };
}
