/** Writes two revisions of one share into `<root>` for the shared-review journey. */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { exportShare } from "@review/sharing/export.js";

import { createShareFixture } from "../test/fixtures/share/create.js";

const root = process.argv[2] && path.resolve(process.argv[2]);

if (!root) throw new Error("Usage: tsx scripts/seed-share-fixture.ts <root>");

const fixture = await createShareFixture(root);

const note = "The second revision adds this note.";

await writeFile(
  path.join(root, "bundle-1.json"),
  JSON.stringify(await exportShare(fixture)),
);

await fixture.store.execute({
  operation: {
    type: "edit",
    reviewId: fixture.reviewId,
    edit: { type: "insert", content: { type: "markdown", markdown: note } },
  },
});

await writeFile(
  path.join(root, "bundle-2.json"),
  JSON.stringify(await exportShare(fixture)),
);

await fixture.data.close();

fixture.store.close();

await writeFile(
  path.join(root, "fixture.json"),
  JSON.stringify({
    reviewId: fixture.reviewId,
    repo: fixture.repo,
    note,
    sourceFile: fixture.sourceFile,
    sourceText: fixture.sourceText,
  }),
);
