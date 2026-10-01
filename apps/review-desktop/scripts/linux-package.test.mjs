import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareReviewArchPackage,
  reviewPackage,
} from "../code-oss/build/linux/review-package.ts";
import { releaseIdentityFor } from "./release-channel.mjs";

const product = (quality) => ({ quality, ...releaseIdentityFor(quality) });

test("the payload quality must match the version shape", () => {
  assert.throws(
    () => reviewPackage(product("stable"), "1.2.4-preview.20260922.7", "1"),
    /quality "stable" does not match/,
  );
  assert.throws(
    () => reviewPackage(product("preview"), "1.2.4", "1"),
    /quality "preview" does not match/,
  );
  assert.throws(() => reviewPackage(product("stable"), "1.2.4-rc.1", "1"));
  assert.throws(() => reviewPackage(product("stable"), "1.2.4", "0"));
});

for (const quality of ["stable", "preview"]) {
  test(`Arch stages a standalone ${quality} install tree without an RPM`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "whiteboard-arch-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const appRoot = path.join(root, "apps/review-desktop");
    const codeRoot = path.join(appRoot, "code-oss");
    const source = path.join(appRoot, "VSCode-linux-x64");
    const version = quality === "stable" ? "1.2.3" : "1.2.4-preview.20260928.1";
    const identity = releaseIdentityFor(quality);
    const suffix = quality === "preview" ? "-preview" : "";

    const write = async (file, value) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, value);
    };

    await write(
      path.join(appRoot, "package.json"),
      JSON.stringify({ version }),
    );
    await write(
      path.join(source, "resources/app/product.json"),
      JSON.stringify({
        ...identity,
        quality,
        reviewVersion: version,
        commit: "a".repeat(40),
      }),
    );
    await write(path.join(source, identity.applicationName), "desktop");
    await write(path.join(source, "chrome-sandbox"), "sandbox");
    await write(path.join(source, "resources/app/LICENSE.txt"), "license");
    await write(
      path.join(source, "resources/app/review-runtime/dist/cli.js"),
      "cli",
    );
    await write(
      path.join(
        root,
        `packages/review/app/icons/review${suffix}-square-512.png`,
      ),
      "icon",
    );

    await prepareReviewArchPackage(codeRoot);

    const staged = path.join(codeRoot, ".build/linux/arch/x86_64/package");
    const app = `whiteboard${suffix}`;
    assert.equal(
      await readFile(path.join(staged, `usr/share/${app}/${app}`), "utf8"),
      "desktop",
    );
    await assert.rejects(lstat(path.join(staged, `usr/bin/review${suffix}`)), {
      code: "ENOENT",
    });
    assert.equal(
      (await stat(path.join(staged, `usr/share/${app}/chrome-sandbox`))).mode &
        0o7777,
      0o4755,
    );
    assert.match(
      await readFile(path.join(staged, `usr/bin/${app}`), "utf8"),
      /ELECTRON_RUN_AS_NODE=1/,
    );
    assert.match(
      await readFile(
        path.join(
          staged,
          `usr/share/applications/dev-fast-review${suffix}.desktop`,
        ),
        "utf8",
      ),
      new RegExp(`Exec=/usr/bin/${app}-desktop`),
    );
  });
}
