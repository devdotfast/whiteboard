import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { compareVersions, promoteAliases } from "./promote-release-aliases.mjs";

// A fake bucket. `race` runs once, just before the first conditional write,
// standing in for another run that moves the pointer in between.
function bucket(objects = {}, race) {
  const puts = [];

  const aws = (command, ...args) => {
    const key = args[args.indexOf("--key") + 1];

    if (command === "put-object" || command === "copy-object") {
      const ifMatch = args.indexOf("--if-match");

      if (race && ifMatch !== -1) {
        race(objects);
        race = undefined;
      }

      if (ifMatch !== -1 && objects[key]?.etag !== args[ifMatch + 1])
        throw new Error("An error occurred (PreconditionFailed) when calling the PutObject operation");

      puts.push([command, ...args]);

      return {};
    }

    const object = objects[key];

    if (!object) throw new Error("An error occurred (404) when calling the HeadObject operation: Not Found");

    if (command === "head-object")
      return { ETag: object.etag, Metadata: object.metadata ?? {}, ContentDisposition: object.disposition };
    writeFileSync(args.at(-1), JSON.stringify(object.body));

    return {};
  };

  return { aws, puts, keys: () => puts.map((args) => args[args.indexOf("--key") + 1]) };
}

const objects = [
  {
    file: "s3:releases/0.2.5/darwin-arm64/Whiteboard-darwin-arm64-0.2.5.dmg",
    key: "releases/preview-latest/darwin-arm64/Whiteboard.dmg",
    downloadName: "wb.dmg",
  },
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

test("a first release creates every alias, the pointer first", () => {
  const store = bucket();
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
  assert.deepEqual(store.keys(), [pointer, objects[0].key]);
  assert.deepEqual(store.puts[0].slice(-2), ["--if-none-match", "*"]);
  assert.equal(store.puts[0][0], "put-object");
  assert.equal(store.puts[1][0], "copy-object");
  assert.ok(store.puts[1].includes("b/releases/0.2.5/darwin-arm64/Whiteboard-darwin-arm64-0.2.5.dmg"));
  assert.ok(store.puts[1].includes('attachment; filename="wb.dmg"'));
});

test("a newer release moves the aliases only if the pointer is unchanged", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.4" } } });
  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
  assert.deepEqual(store.puts[0].slice(-2), ["--if-match", '"e1"']);
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

test("an alias from before version metadata is read from its download name", () => {
  const disposition = 'attachment; filename="Whiteboard-Preview-0.2.5-preview.20261015.117-Setup.exe"';
  const setup = [{ file: "Setup.exe", key: "releases/preview-latest/win32-x64/Whiteboard-Setup.exe" }];
  const store = bucket({ [setup[0].key]: { etag: '"e1"', disposition } });

  assert.equal(
    promoteAliases({ bucket: "b", version: "0.2.5-preview.20261014.90", objects: setup, aws: store.aws }),
    false,
  );
});

test("a run that loses the race to a newer release backs off", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.4" } } }, (objects) => {
    objects[pointer] = { etag: '"e2"', metadata: { version: "0.2.6" } };
  });

  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), false);
  assert.deepEqual(store.puts, []);
});

test("a run that loses the race to an older release still moves the aliases", () => {
  const store = bucket({ [pointer]: { etag: '"e1"', metadata: { version: "0.2.4" } } }, (objects) => {
    objects[pointer] = { etag: '"e2"', metadata: { version: "0.2.4" } };
  });

  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects, aws: store.aws }), true);
  assert.deepEqual(store.puts[0].slice(-2), ["--if-match", '"e2"']);
});

test("a Windows feed from before version metadata is read for its version", () => {
  const feed = [{ file: "user.json", key: "update/stable/win32-x64-user/latest.json" }];
  const store = bucket({ [feed[0].key]: { etag: '"e1"', body: { version: "0.2.6", commit: "abc" } } });

  assert.equal(promoteAliases({ bucket: "b", version: "0.2.5", objects: feed, aws: store.aws }), false);
});
