import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseJsonText } from "@dev.fast/json";
import { z } from "zod";

import { findReviewPackageRoot } from "./package-paths";
import { downloadPinned } from "./pinned-download";
import { devReviewHome } from "./review-home-paths";
import { extractVsix, sanitizeVsixManifest } from "./vsix";

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
  signal?: AbortSignal;
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
        input.signal,
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

  const kept = new Set(listed.map((entry) => entry.relativeLocation));

  for (const folder of await readdir(extensionsDir))
    if (
      !kept.has(folder) &&
      curated.some(
        ({ id }) =>
          folder.startsWith(`${id}-`) &&
          /^\d/.test(folder.slice(id.length + 1)),
      )
    )
      await rm(path.join(extensionsDir, folder), {
        recursive: true,
        force: true,
      });

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
  timeoutMs?: number,
  signal?: AbortSignal,
) {
  const part = `${directory}.${process.pid}.vsix`;
  const staging = `${directory}.${process.pid}.staging`;

  try {
    await downloadPinned(download, part, { timeoutMs, signal });
    await rm(staging, { recursive: true, force: true });
    await extractVsix(part, staging, download.size * 8);
    await sanitizeVsixManifest(staging, extension);

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
