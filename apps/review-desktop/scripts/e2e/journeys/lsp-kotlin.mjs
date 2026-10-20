import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";
import { hoverAndJump, lspOptions, runLspJourney } from "../lsp-languages.mjs";

export const name = "lsp-kotlin";

export const phase = 2;

export const options = lspOptions("kotlin");

export async function run(ctx) {
  await runLspJourney(ctx, "kotlin");

  const head = await ctx.git("rev-parse", "HEAD");

  for (const [file, symbol, hoverText] of [
    [
      "build.gradle.kts",
      "artifactName",
      /fun artifactName\(name: String\): String/,
    ],
    [
      "settings.gradle.kts",
      "projectName",
      /fun projectName\(name: String\): String/,
    ],
  ]) {
    const lines = (await readFile(path.join(ctx.repo, file), "utf8")).split(
      "\n",
    );

    const callLine =
      lines.findIndex((line) => line.includes(`= ${symbol}(`)) + 1;

    assert.ok(callLine > 0, `${file} does not call ${symbol}`);

    const review = await createReview(ctx, {
      title: `${file} peek`,
      head,
      blocks: [
        {
          type: "code_peek",
          source: {
            file,
            start: { side: "head", line: callLine },
            end: { side: "head", line: callLine },
          },
        },
      ],
    });

    await hoverAndJump(
      ctx,
      "kotlin",
      {
        peekFile: file,
        symbol,
        definitionFile: file,
        hoverText,
        hoverTimeout: 300000,
        checksReferences: true,
      },
      review.canvas,
      lines,
      callLine,
    );
  }
}
