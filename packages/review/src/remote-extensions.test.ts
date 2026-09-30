import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import {
  type CuratedRemoteExtension,
  ensureRemoteExtensions,
  remoteExtensionTarget,
  remoteServerPaths,
} from "@review/remote-extensions.js";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;

let env: NodeJS.ProcessEnv;

let server: Server;

let base: string;

let requests: string[];

const files = new Map<string, Buffer>();

/** A VSIX: a zip whose `extension/` folder holds the extension. */
function vsix(entries: Record<string, { data: string; mode?: number }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, { data, mode = 0o644 }] of Object.entries(entries)) {
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const fileName = Buffer.from(name);
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(8, 4);
    common.writeUInt32LE(crc32(raw), 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(fileName.length, 22);

    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 3, 4]),
      common,
      fileName,
      packed,
    ]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    common.copy(central, 6);
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local);
    centrals.push(central, fileName);
    offset += local.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(locals.length, 8);
  end.writeUInt16LE(locals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

function serve(name: string, data: Buffer) {
  files.set(`/${name}`, data);

  return {
    universal: false,
    url: `${base}/${name}`,
    sha256: createHash("sha256").update(data).digest("hex"),
    size: data.length,
  };
}

/** ty as its VSIX ships it: a manifest and a server binary under bundled/libs/bin. */
function tyExtension(
  overrides: Partial<CuratedRemoteExtension> = {},
): CuratedRemoteExtension {
  const download = serve(
    "ty.vsix",
    vsix({
      "extension/package.json": {
        data: JSON.stringify({
          publisher: "astral-sh",
          name: "ty",
          version: "1.0.0",
          scripts: { build: "x" },
          dependencies: { a: "1" },
          extensionPack: ["ms-python.vscode-pylance"],
          activationEvents: ["onLanguage:python"],
        }),
      },
      "extension/bundled/libs/bin/ty": {
        data: "#!/bin/sh\necho ty 1.0.0\n",
        mode: 0o755,
      },
    }),
  );

  return {
    id: "astral-sh.ty",
    version: "1.0.0",
    tier: "bundled",
    group: "python",
    executables: ["bundled/libs/bin/ty"],
    stripExtensionPack: true,
    addActivationEvents: ["onLanguage:ty-test"],
    targets: { "linux-x64": download, "linux-arm64": download },
    ...overrides,
  };
}

/** Go is optional on the Desktop: it runs `go install` when it activates. */
function goExtension(): CuratedRemoteExtension {
  const download = serve(
    "go.vsix",
    vsix({
      "extension/package.json": {
        data: JSON.stringify({
          publisher: "golang",
          name: "go",
          version: "1.0.0",
        }),
      },
    }),
  );

  return {
    id: "golang.go",
    version: "1.0.0",
    tier: "optional",
    group: "go",
    executables: [],
    stripExtensionPack: false,
    addActivationEvents: [],
    targets: { "linux-x64": download, "linux-arm64": download },
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "wb-remote-ext-"));
  env = { ...process.env, DEV_REVIEW_HOME: root };
  requests = [];
  files.clear();
  server = createServer((request, response) => {
    requests.push(request.url ?? "");
    const data = files.get(request.url ?? "");
    response.writeHead(data ? 200 : 404).end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

it("installs the extension, applies the manifest's changes, lists it for the scanner and clears the scan cache", async () => {
  const { extensionsDir, serverDataDir } = remoteServerPaths(env);

  const cache = path.join(
    serverDataDir,
    "data",
    "CachedProfilesData",
    "__default__profile__",
  );

  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, "extensions.user.cache"), "{}");

  const result = await ensureRemoteExtensions({
    env,
    curated: [tyExtension()],
    target: "linux-x64",
  });

  expect(result).toMatchObject({
    event: "remote.extensions",
    installed: ["astral-sh.ty"],
    skipped: [],
    failed: [],
  });

  const directory = path.join(extensionsDir, "astral-sh.ty-1.0.0");

  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );

  expect(manifest).not.toHaveProperty("scripts");
  expect(manifest).not.toHaveProperty("dependencies");
  expect(manifest).not.toHaveProperty("extensionPack");
  expect(manifest.activationEvents).toEqual([
    "onLanguage:python",
    "onLanguage:ty-test",
  ]);
  expect(
    (await stat(path.join(directory, "bundled/libs/bin/ty"))).mode & 0o111,
  ).not.toBe(0);

  expect(
    JSON.parse(
      await readFile(path.join(extensionsDir, "extensions.json"), "utf8"),
    ),
  ).toEqual([
    {
      identifier: { id: "astral-sh.ty" },
      version: "1.0.0",
      location: { $mid: 1, scheme: "file", path: directory },
      relativeLocation: "astral-sh.ty-1.0.0",
      metadata: {
        installedTimestamp: expect.any(Number),
        targetPlatform: "linux-x64",
      },
    },
  ]);
  expect(
    existsSync(path.join(serverDataDir, "data", "CachedProfilesData")),
  ).toBe(false);
  // Only the extension and the list: no download or staging folder is left.
  expect((await readdir(extensionsDir)).sort()).toEqual([
    "astral-sh.ty-1.0.0",
    "extensions.json",
  ]);
});

it("downloads nothing and leaves the list alone the second time", async () => {
  const curated = [tyExtension()];
  await ensureRemoteExtensions({ env, curated, target: "linux-x64" });

  const list = await readFile(
    path.join(remoteServerPaths(env).extensionsDir, "extensions.json"),
    "utf8",
  );

  requests = [];

  const result = await ensureRemoteExtensions({
    env,
    curated,
    target: "linux-x64",
  });

  expect(result).toMatchObject({
    installed: [],
    skipped: [{ id: "astral-sh.ty", reason: "up to date" }],
    failed: [],
  });
  expect(requests).toEqual([]);
  expect(
    await readFile(
      path.join(remoteServerPaths(env).extensionsDir, "extensions.json"),
      "utf8",
    ),
  ).toBe(list);
});

it("deletes a download that fails its checksum and installs nothing", async () => {
  const extension = tyExtension();
  const wrong = { ...extension.targets["linux-x64"], sha256: "0".repeat(64) };

  const result = await ensureRemoteExtensions({
    env,
    curated: [
      { ...extension, targets: { "linux-x64": wrong, "linux-arm64": wrong } },
    ],
    target: "linux-x64",
  });

  expect(result.installed).toEqual([]);
  expect(result.failed).toEqual([
    { id: "astral-sh.ty", error: expect.stringMatching(/Checksum mismatch/) },
  ]);
  const { extensionsDir } = remoteServerPaths(env);
  expect(await readdir(extensionsDir)).toEqual(["extensions.json"]);
  expect(
    JSON.parse(
      await readFile(path.join(extensionsDir, "extensions.json"), "utf8"),
    ),
  ).toEqual([]);
});

it("names the network when the download cannot reach it", async () => {
  const extension = tyExtension();
  await new Promise((resolve) => server.close(resolve));

  const result = await ensureRemoteExtensions({
    env,
    curated: [extension],
    target: "linux-x64",
  });

  expect(result.failed).toEqual([
    {
      id: "astral-sh.ty",
      error: expect.stringMatching(
        /^Network error reaching 127\.0\.0\.1:\d+: ECONNREFUSED$/,
      ),
    },
  ]);
  expect(await readdir(remoteServerPaths(env).extensionsDir)).toEqual([
    "extensions.json",
  ]);
});

it("stops a stalled download when its signal aborts, and leaves nothing behind", async () => {
  const extension = tyExtension();
  server.removeAllListeners("request");
  // Headers, then nothing: the body never ends.
  server.on("request", (_request, response) =>
    response.writeHead(200).write("x"),
  );
  const stop = new AbortController();
  setTimeout(() => stop.abort(new Error("stopped for the test")), 200);

  const started = Date.now();

  const result = await ensureRemoteExtensions({
    env,
    curated: [extension],
    target: "linux-x64",
    signal: stop.signal,
  });

  expect(Date.now() - started).toBeLessThan(5_000);
  expect(result.failed).toEqual([
    {
      id: "astral-sh.ty",
      error: expect.stringMatching(/stopped for the test$/),
    },
  ]);
  expect(await readdir(remoteServerPaths(env).extensionsDir)).toEqual([
    "extensions.json",
  ]);
  server.closeAllConnections();
});

it("fails an extension whose executable does not run", async () => {
  const extension = tyExtension({ executables: ["bundled/libs/bin/missing"] });

  const result = await ensureRemoteExtensions({
    env,
    curated: [extension],
    target: "linux-x64",
  });

  expect(result.failed).toEqual([
    {
      id: "astral-sh.ty",
      error: expect.stringMatching(
        /bundled\/libs\/bin\/missing does not run here/,
      ),
    },
  ]);
  expect(await readdir(remoteServerPaths(env).extensionsDir)).toEqual([
    "extensions.json",
  ]);
});

it("installs an optional extension only when its group is requested", async () => {
  const curated = [tyExtension(), goExtension()];

  const without = await ensureRemoteExtensions({
    env,
    curated,
    target: "linux-x64",
  });

  expect(without).toMatchObject({
    installed: ["astral-sh.ty"],
    skipped: [{ id: "golang.go", reason: 'optional group "go" not requested' }],
    failed: [],
  });
  expect(requests).toEqual(["/ty.vsix"]);

  const withGo = await ensureRemoteExtensions({
    env,
    curated,
    groups: ["go"],
    target: "linux-x64",
  });

  expect(withGo).toMatchObject({ installed: ["golang.go"], failed: [] });
  expect(requests).toEqual(["/ty.vsix", "/go.vsix"]);

  const list = JSON.parse(
    await readFile(
      path.join(remoteServerPaths(env).extensionsDir, "extensions.json"),
      "utf8",
    ),
  );

  expect(
    list.map((entry: { identifier: { id: string } }) => entry.identifier.id),
  ).toEqual(["astral-sh.ty", "golang.go"]);
});

/** An optional-tier extension of `group` with nothing in it but its manifest. */
function optionalExtension(
  id: string,
  group: string,
  overrides: Partial<CuratedRemoteExtension> = {},
): CuratedRemoteExtension {
  const [publisher, name] = id.split(".");

  const download = serve(
    `${id}.vsix`,
    vsix({
      "extension/package.json": {
        data: JSON.stringify({ publisher, name, version: "1.0.0" }),
      },
    }),
  );

  return {
    id,
    version: "1.0.0",
    tier: "optional",
    group,
    executables: [],
    stripExtensionPack: false,
    addActivationEvents: [],
    targets: { "linux-x64": download, "linux-arm64": download },
    ...overrides,
  };
}

it("reports each requested group, and installs nothing of a group the Desktop has not turned on", async () => {
  const lldb = optionalExtension("llvm-vs-code-extensions.lldb-dap", "swift");

  const curated = [
    optionalExtension("rust-lang.rust-analyzer", "rust"),
    optionalExtension("swiftlang.swift-vscode", "swift"),
    lldb,
    optionalExtension("muhammad-sammy.csharp", "csharp", {
      targets: {
        "linux-x64": { ...lldb.targets["linux-x64"], sha256: "0".repeat(64) },
        "linux-arm64": lldb.targets["linux-arm64"],
      },
    }),
  ];

  const result = await ensureRemoteExtensions({
    env,
    curated,
    groups: ["swift", "csharp"],
    target: "linux-x64",
  });

  expect(result.installed).toEqual([
    "swiftlang.swift-vscode",
    "llvm-vs-code-extensions.lldb-dap",
  ]);
  expect(result.groups).toEqual([
    { group: "swift", installed: true },
    {
      group: "csharp",
      installed: false,
      detail: expect.stringMatching(
        /^muhammad-sammy\.csharp: Checksum mismatch/,
      ),
    },
  ]);
  expect(requests).not.toContain("/rust-lang.rust-analyzer.vsix");
  expect((await readdir(remoteServerPaths(env).extensionsDir)).sort()).toEqual([
    "extensions.json",
    "llvm-vs-code-extensions.lldb-dap-1.0.0",
    "swiftlang.swift-vscode-1.0.0",
  ]);
});

it("refuses a VSIX with a path that leaves its folder, or a symlink, and writes nothing", async () => {
  const manifest = {
    data: JSON.stringify({
      publisher: "astral-sh",
      name: "ty",
      version: "1.0.0",
    }),
  };

  for (const [name, entry] of [
    ["escape.vsix", { "extension/../../escaped.txt": { data: "x" } }],
    [
      "symlink.vsix",
      { "extension/link": { data: "/etc/passwd", mode: 0o120777 } },
    ],
  ] as const) {
    const download = serve(
      name,
      vsix({ "extension/package.json": manifest, ...entry }),
    );

    const result = await ensureRemoteExtensions({
      env,
      curated: [
        tyExtension({
          executables: [],
          targets: { "linux-x64": download, "linux-arm64": download },
        }),
      ],
      target: "linux-x64",
    });

    // yauzl refuses a `..` entry itself; the symlink is refused by our check.
    expect(result.failed).toEqual([
      {
        id: "astral-sh.ty",
        error: expect.stringMatching(
          /invalid relative path|VSIX contains a symlink/,
        ),
      },
    ]);
  }

  const { extensionsDir } = remoteServerPaths(env);
  expect(await readdir(extensionsDir)).toEqual(["extensions.json"]);
  expect(await readdir(path.dirname(extensionsDir))).toEqual(["extensions"]);
});

it("refuses a machine that is not Linux on x64 or arm64", () => {
  expect(remoteExtensionTarget("linux", "arm64")).toBe("linux-arm64");
  expect(() => remoteExtensionTarget("darwin", "arm64")).toThrow(
    "Language features on a remote need Linux on x64 or arm64; this machine is darwin-arm64.",
  );
});
