import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { canvasTargets } from "./copy-canvas.mjs";

test("canvas targets are derived from fixed output locations", () => {
  const fakeAppRoot = path.resolve("/tmp/review desktop");
  const packagedRoot = path.resolve("/tmp/review package");
  const packagedMacRoot = path.resolve("/tmp/Review.app");

  assert.deepEqual(canvasTargets([], fakeAppRoot), [
    path.join(fakeAppRoot, "code-oss/out/vs/review/canvas"),
  ]);
  assert.deepEqual(
    canvasTargets(["--packaged-root", packagedRoot], fakeAppRoot),
    [
      path.join(fakeAppRoot, "code-oss/out/vs/review/canvas"),
      path.join(packagedRoot, "resources/app/out/vs/review/canvas"),
    ],
  );
  // A macOS bundle nests its resources under Contents/; without this the mac
  // packaging script writes outside the bundle and refuses to continue.
  assert.deepEqual(
    canvasTargets(["--packaged-root", packagedMacRoot], fakeAppRoot),
    [
      path.join(fakeAppRoot, "code-oss/out/vs/review/canvas"),
      path.join(packagedMacRoot, "Contents/Resources/app/out/vs/review/canvas"),
    ],
  );
  assert.throws(
    () => canvasTargets(["--packaged-root", path.parse(packagedRoot).root]),
    /filesystem root/,
  );
  assert.throws(() => canvasTargets(["--output", packagedRoot]), /usage:/);
});

