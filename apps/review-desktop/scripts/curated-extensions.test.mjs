import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  bundledExtensions,
  bundledGroups,
  curatedExtensions,
  curatedGroups,
  defaultDisabledIds,
  keymapGroups,
  openVsxUrl,
  optionalExtensions,
  parseGroupSelection,
  remoteExtensionIds,
  remoteTargets,
  supportedTargets,
  targetKeyFor,
} from "./curated-extensions.manifest.mjs";
import {
  copyCuratedExtensions,
  extractVsixPayload,
  verifyCuratedExtensions,
} from "./curated-extensions.mjs";

const APP_DIR = path.dirname(fileURLToPath(new URL("./", import.meta.url)));

const EXTENSIONS_DIR = path.join(APP_DIR, "code-oss", "extensions");

const codeOssRequire = createRequire(
  path.join(APP_DIR, "code-oss", "package.json"),
);

const buildExtensions = await readFile(
  new URL("../code-oss/build/lib/extensions.ts", import.meta.url),
  "utf8",
);

const curatedContribution = await readFile(
  new URL(
    "../code-oss/src/vs/review/contrib/extensions/reviewCuratedExtensions.contribution.ts",
    import.meta.url,
  ),
  "utf8",
);

const reviewConfiguration = await readFile(
  new URL(
    "../code-oss/src/vs/review/common/reviewConfigurationDefaults.ts",
    import.meta.url,
  ),
  "utf8",
);

async function loadImportFreeTypeScriptModule(url) {
  const source = await readFile(url, "utf8");

  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`
  );
}

const mainOptionalCatalog = (
  await loadImportFreeTypeScriptModule(
    new URL(
      "../code-oss/src/vs/review/node/reviewOptionalExtensionCatalog.ts",
      import.meta.url,
    ),
  )
).reviewOptionalExtensionCatalog;

test("pins every curated extension to a checksum for every supported target", () => {
  assert.ok(curatedExtensions.length > 0);

  for (const extension of curatedExtensions) {
    assert.equal(
      extension.id,
      `${extension.namespace}.${extension.name}`.toLowerCase(),
      `${extension.id} must be <namespace>.<name> lowercased`,
    );
    assert.ok(curatedGroups.includes(extension.group), `${extension.id} group`);
    assert.ok(
      ["bundled", "optional"].includes(extension.tier),
      `${extension.id} tier`,
    );
    assert.match(extension.version, /^\d/, `${extension.id} version`);

    const targetKeys = Object.keys(extension.targets);

    if (extension.targets.universal) {
      assert.deepEqual(targetKeys, ["universal"], `${extension.id} targets`);
    } else {
      const expected = remoteExtensionIds.includes(extension.id)
        ? new Set([...supportedTargets, ...remoteTargets])
        : new Set(supportedTargets);

      assert.deepEqual(
        targetKeys.sort(),
        [...expected].sort(),
        `${extension.id} must pin every supported target`,
      );
    }

    for (const [targetKey, target] of Object.entries(extension.targets)) {
      assert.match(
        target.sha256,
        /^[0-9a-f]{64}$/,
        `${extension.id} ${targetKey} sha256`,
      );

      if (extension.tier === "optional") {
        assert.equal(
          target.url,
          openVsxUrl({
            namespace: extension.namespace,
            name: extension.name,
            version: extension.version,
            target: targetKey === "universal" ? undefined : targetKey,
          }),
          `${extension.id} ${targetKey} url`,
        );
        assert.ok(
          Number.isSafeInteger(target.size) && target.size > 0,
          `${extension.id} ${targetKey} size`,
        );
      }
    }
  }
});

test("keeps every optional pin identical in build, main, and renderer catalogs", () => {
  const normalize = (catalog) =>
    catalog
      .flatMap((extension) =>
        Object.entries(extension.targets).map(([target, pin]) => ({
          id: extension.id,
          role: extension.role,
          group: extension.group,
          version: extension.version,
          target,
          url: pin.url,
          sha256: pin.sha256,
          size: pin.size,
        })),
      )
      .sort((left, right) =>
        `${left.id}:${left.target}`.localeCompare(
          `${right.id}:${right.target}`,
        ),
      );

  const buildPins = normalize(optionalExtensions);
  assert.deepEqual(normalize(mainOptionalCatalog), buildPins);
});

test("keeps the curated identifiers unique", () => {
  const ids = curatedExtensions.map((extension) => extension.id);
  assert.deepEqual(ids, [...new Set(ids)], "duplicate curated extension id");
});

test("parses DEV_REVIEW_EXTENSIONS selections", () => {
  assert.deepEqual(
    [...parseGroupSelection(undefined)].sort(),
    [...bundledGroups].sort(),
  );
  assert.deepEqual(
    [...parseGroupSelection("all")].sort(),
    [...bundledGroups].sort(),
  );
  assert.deepEqual([...parseGroupSelection("none")], []);
  assert.deepEqual([...parseGroupSelection("rust, vim")].sort(), [
    "rust",
    "vim",
  ]);
  assert.throws(() => parseGroupSelection("nope"), /unknown extension group/);
});

test("keeps curated extensions out of the gulp packaging stream", () => {
  for (const extension of curatedExtensions) {
    assert.ok(
      buildExtensions.includes(`'${extension.id}'`),
      `${extension.id} must be listed in excludedExtensions in build/lib/extensions.ts`,
    );
  }
});

test("extracts nested Windows executables from a VSIX archive", async () => {
  const yazl = codeOssRequire("yazl");
  const root = mkdtempSync(path.join(os.tmpdir(), "review-vsix-extract-"));
  const archive = path.join(root, "fixture.vsix");
  const destination = path.join(root, "extension");
  const zip = new yazl.ZipFile();
  const chunks = [];

  const complete = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.once("end", resolve);
    zip.outputStream.once("error", reject);
  });

  zip.addBuffer(
    Buffer.from("windows executable fixture"),
    "extension/bundled/libs/bin/ty.exe",
  );
  zip.addBuffer(
    Buffer.from('{"publisher":"astral-sh","name":"ty"}'),
    "extension/package.json",
  );
  zip.end();

  try {
    await complete;
    writeFileSync(archive, Buffer.concat(chunks));
    await extractVsixPayload(archive, destination);

    assert.equal(
      readFileSync(
        path.join(destination, "bundled", "libs", "bin", "ty.exe"),
        "utf8",
      ),
      "windows executable fixture",
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"))
        .name,
      "ty",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The payloads are downloaded rather than committed, so a clean checkout has
// nothing to inspect. When they are present, hold them to the contract the
// materialize step promises.
const materialized = curatedExtensions.filter((extension) =>
  existsSync(path.join(EXTENSIONS_DIR, extension.id, "package.json")),
);

test(
  "materialized extensions match their pinned manifest entry",
  { skip: materialized.length === 0 && "no curated extensions materialized" },
  () => {
    for (const extension of materialized) {
      const directory = path.join(EXTENSIONS_DIR, extension.id);

      const stamp = JSON.parse(
        readFileSync(path.join(directory, ".curated.json"), "utf8"),
      );

      assert.equal(stamp.id, extension.id);
      assert.equal(stamp.version, extension.version);
      assert.equal(stamp.sha256, extension.targets[stamp.target].sha256);

      const manifest = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
      );

      assert.equal(
        manifest.dependencies,
        undefined,
        `${extension.id} dependencies`,
      );
      assert.equal(manifest.scripts, undefined, `${extension.id} scripts`);

      if (extension.stripExtensionPack) {
        assert.equal(
          manifest.extensionPack,
          undefined,
          `${extension.id} extensionPack`,
        );
      }

      for (const relative of extension.executables) {
        const windowsTarget = stamp.target.startsWith("win32-");

        const executable = path.join(
          directory,
          windowsTarget ? `${relative}.exe` : relative,
        );

        assert.ok(
          existsSync(executable),
          `${extension.id} is missing ${relative}`,
        );

        if (!windowsTarget) {
          assert.ok(
            statSync(executable).mode & 0o111,
            `${extension.id} ${relative} must stay executable`,
          );
        }
      }
    }
  },
);

test("copies only bundled extensions for each package target", () => {
  for (const target of supportedTargets) {
    const root = mkdtempSync(path.join(os.tmpdir(), "review-curated-copy-"));
    const sourceRoot = path.join(root, "source");
    const destinationRoot = path.join(root, "destination");

    try {
      for (const extension of bundledExtensions) {
        const targetKey = targetKeyFor(extension, target);
        assert.ok(targetKey, `${extension.id} must support ${target}`);
        const directory = path.join(sourceRoot, extension.id);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          path.join(directory, "package.json"),
          `${JSON.stringify({
            publisher: extension.namespace,
            name: extension.name,
            version: extension.version,
          })}\n`,
        );
        writeFileSync(
          path.join(directory, ".curated.json"),
          `${JSON.stringify({
            id: extension.id,
            version: extension.version,
            target: targetKey,
            sha256: extension.targets[targetKey].sha256,
          })}\n`,
        );

        for (const relative of extension.executables) {
          const executable = path.join(
            directory,
            target.startsWith("win32-") ? `${relative}.exe` : relative,
          );

          mkdirSync(path.dirname(executable), { recursive: true });
          writeFileSync(executable, "fixture\n");
          chmodSync(executable, 0o755);
        }
      }

      copyCuratedExtensions({ destinationRoot, sourceRoot, target });
      verifyCuratedExtensions({ root: destinationRoot, target });

      for (const extension of bundledExtensions) {
        assert.ok(
          existsSync(path.join(destinationRoot, extension.id, "package.json")),
          `${extension.id} must reach the ${target} destination`,
        );
      }

      for (const extension of optionalExtensions) {
        assert.ok(
          !existsSync(path.join(destinationRoot, extension.id)),
          `${extension.id} must stay out of the ${target} package`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("keeps the in-app picker list in sync with the manifest", () => {
  // Phase 1 keeps the existing bundled picker contract. Optional entries get
  // their group rows when the trusted runtime installer is connected.
  for (const extension of bundledExtensions) {
    assert.ok(
      curatedContribution.includes(`id: '${extension.id}'`),
      `${extension.id} must appear in reviewCuratedExtensions.contribution.ts`,
    );
  }

  // Nothing may be offered that this build does not vendor.
  const offered = [...curatedContribution.matchAll(/\{ id: '([^']+)'/g)].map(
    (match) => match[1],
  );

  const known = new Set(curatedExtensions.map((extension) => extension.id));

  for (const id of offered) {
    assert.ok(known.has(id), `${id} is offered by the picker but not vendored`);
  }
});

test("keeps the keymaps mutually exclusive in the picker", () => {
  for (const id of defaultDisabledIds) {
    assert.ok(
      curatedContribution.includes(`'${id}'`),
      `${id} must be listed as a keymap in the picker`,
    );
  }

  const enumDeclaration = reviewConfiguration.match(
    /REVIEW_KEYMAPS\s*=\s*\[([^\]]+)\]/,
  );

  assert.ok(enumDeclaration, "review.keymap enum declaration");

  const enumValues = [...enumDeclaration[1].matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(enumValues, ["none", ...keymapGroups]);

  for (const keymap of keymapGroups) {
    assert.match(
      curatedContribution,
      new RegExp(`${keymap}:\\s*'[^']+'`),
      `${keymap} must map to a curated extension`,
    );
  }
});
