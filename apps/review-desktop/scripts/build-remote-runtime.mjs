#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const codeOss = path.join(appDirectory, "code-oss");

const monorepoRoot = path.resolve(appDirectory, "..", "..");

export const DEFAULT_REMOTE_RUNTIME = path.join(
  codeOss,
  ".build/remote-runtime",
);

export const REMOTE_RUNTIME_ENTRIES = [
  "server-main",
  "bootstrap-fork",
  "vs/workbench/api/node/extensionHostProcess",
  "vs/platform/files/node/watcher/watcherMain",
];

export const OPTIONAL_NATIVE_PACKAGES = [
  "@parcel/watcher",
  "@vscode/deviceid",
  "@vscode/native-watchdog",
  "@vscode/spdlog",
  "@vscode/sqlite3",
  "@vscode/windows-ca-certs",
  "@vscode/windows-process-tree",
  "@vscode/windows-registry",
  "electron",
  "kerberos",
  "native-keymap",
  "node-pty",
  "vsda",
];

export const REMOTE_BUILTIN_EXTENSIONS = [
  "typescript-language-features",
  "json-language-features",
  "css-language-features",
  "html-language-features",
];

async function buildBuiltinExtensions(out) {
  const buildRequire = createRequire(path.join(codeOss, "build/package.json"));
  const vsce = buildRequire("@vscode/vsce");
  const extensions = path.join(codeOss, "extensions");

  for (const name of REMOTE_BUILTIN_EXTENSIONS) {
    const source = path.join(extensions, name);
    const destination = path.join(out, "extensions", name);

    execFileSync(process.execPath, ["esbuild.mts"], {
      cwd: source,
      stdio: ["ignore", "ignore", "inherit"],
    });

    const files = await vsce.listFiles({
      cwd: source,
      packageManager: vsce.PackageManager.None,
    });

    for (const file of files.filter((f) => !f.endsWith(".map"))) {
      fs.cpSync(path.join(source, file), path.join(destination, file));
    }

    const manifestPath = path.join(destination, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    delete manifest.scripts;
    delete manifest.dependencies;
    delete manifest.devDependencies;
    manifest.main &&= manifest.main.replace("/out/", "/dist/");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }

  fs.cpSync(
    path.join(extensions, "node_modules/typescript"),
    path.join(out, "extensions/node_modules/typescript"),
    { recursive: true },
  );
}

function desktopCommit() {
  const fromEnv = process.env.BUILD_SOURCEVERSION?.trim();

  if (fromEnv && /^[0-9a-f]{40}$/i.test(fromEnv)) return fromEnv;

  return execFileSync("git", ["-C", monorepoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function packageName(specifier) {
  const parts = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export async function buildRemoteRuntime({
  out = DEFAULT_REMOTE_RUNTIME,
  commit = desktopCommit(),
} = {}) {
  const buildRequire = createRequire(path.join(codeOss, "build/package.json"));
  const esbuild = buildRequire("esbuild");

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "extensions"), { recursive: true });

  const product = JSON.parse(
    fs.readFileSync(path.join(codeOss, "product.json"), "utf8"),
  );

  fs.writeFileSync(
    path.join(out, "product.json"),
    `${JSON.stringify({ ...product, commit }, null, "\t")}\n`,
  );

  const { name, version } = JSON.parse(
    fs.readFileSync(path.join(codeOss, "package.json"), "utf8"),
  );

  fs.writeFileSync(
    path.join(out, "package.json"),
    `${JSON.stringify({ name, version, type: "module" }, null, "\t")}\n`,
  );

  const tslib = fs.readFileSync(
    path.join(codeOss, "node_modules/tslib/tslib.es6.js"),
    "utf8",
  );

  const banner = [
    'import { createRequire as __wbCreateRequire } from "node:module";',
    'import { dirname as __wbDirname } from "node:path";',
    'import { fileURLToPath as __wbFileURLToPath } from "node:url";',
    "const require = __wbCreateRequire(import.meta.url);",
    "const __filename = __wbFileURLToPath(import.meta.url);",
    "const __dirname = __wbDirname(__filename);",
    tslib,
  ].join("\n");

  const external = OPTIONAL_NATIVE_PACKAGES.flatMap((pkg) => [
    pkg,
    `${pkg}/*`,
  ]);

  const results = await Promise.all(
    REMOTE_RUNTIME_ENTRIES.map((entry) =>
      esbuild.build({
        absWorkingDir: codeOss,
        entryPoints: [path.join(codeOss, "src", `${entry}.ts`)],
        outfile: path.join(out, "out", `${entry}.js`),
        bundle: true,
        format: "esm",
        platform: "node",
        target: ["es2024"],
        external,
        minify: true,
        treeShaking: true,
        metafile: true,
        banner: { js: banner },
        logLevel: "warning",
        logOverride: { "unsupported-require-call": "silent" },
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            useDefineForClassFields: false,
          },
        },
      }),
    ),
  );

  const unexpected = new Set();

  for (const result of results) {
    for (const output of Object.values(result.metafile.outputs)) {
      for (const { path: specifier, external: isExternal } of output.imports) {
        if (!isExternal || isBuiltin(specifier)) continue;

        if (!OPTIONAL_NATIVE_PACKAGES.includes(packageName(specifier))) {
          unexpected.add(specifier);
        }
      }
    }
  }

  if (unexpected.size > 0) {
    throw new Error(
      `remote runtime left imports unbundled: ${[...unexpected].join(", ")}`,
    );
  }

  await buildBuiltinExtensions(out);

  return { out, commit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { out: { type: "string" }, commit: { type: "string" } },
  });

  const started = Date.now();

  const { out, commit } = await buildRemoteRuntime({
    out: values.out ? path.resolve(values.out) : undefined,
    commit: values.commit,
  });

  console.log(
    `remote runtime at ${out} (commit ${commit}) in ${Date.now() - started} ms`,
  );
}
