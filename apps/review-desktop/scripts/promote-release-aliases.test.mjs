import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { compareVersions, promoteAliases } from "./promote-release-aliases.mjs";

function bucket(objects = {}) {
  const puts = [];

  const aws = (command, ...args) => {
    const key = args[args.indexOf("--key") + 1];

    if (command === "put-object") {
      puts.push(args);

      return {};
    }

    const object = objects[key];

    if (!object) throw new Error("An error occurred (404) when calling the HeadObject operation: Not Found");

    if (command === "head-object") return { ETag: object.etag, Metadata: object.metadata ?? {} };
    writeFileSync(args.at(-1), JSON.stringify(object.body));

    return {};
  };

  return { aws, puts, keys: () => puts.map((args) => args[args.indexOf("--key") + 1]) };
}

const objects = [
  { file: "Whiteboard.dmg", key: "releases/preview-latest/darwin-arm64/Whiteboard.dmg", downloadName: "wb.dmg" },
  { file: "latest.json", key: "update/preview/darwin-arm64/latest.json" },
];

const pointer = objects[1].key;

test("orders previews by date, then run", () => {
  assert.ok(compareVersions("0.2.5-preview.20261015.117", "0.2.5-preview.20261014.200") > 0);
  assert.ok(compareVersions("0.2.5-preview.20261015.9", "0.2.5-preview.20261015.10") < 0);
  assert.ok(compareVersions("0.2.6", "0.2.5") > 0);
  assert.equal(compareVersions("0.2.5", "0.2.5"), 0);
  assert.throws(() => compareVersions("v0.2.5", "0.2.5"));
});

test("a first release creates every alias, the pointer last", () => {
  const store = bucket();
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
  assert.deepEqual(store.keys(), [objects[0].key, pointer]);
  assert.deepEqual(store.puts[1].slice(-2), ["--if-none-match", "*"]);
  assert.ok(store.puts[0].includes('attachment; filename="wb.dmg"'));
});

test("a newer release moves the aliases only if the pointer is unchanged", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.4" } } });
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
  assert.deepEqual(store.puts[1].slice(-2), ["--if-match", '"e1"']);
  assert.ok(store.puts.every((args) => args.includes("version=0.2.5")));
});

test("a backfill of an older release leaves the aliases alone", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.6" } } });
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), false);
  assert.deepEqual(store.puts, []);
});

test("a rerun of the same release rewrites the aliases", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.5" } } });
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
});

test("a manifest from before version metadata is read for its version", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', body: { productVersion: "0.2.6" } } });
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), false);
});
