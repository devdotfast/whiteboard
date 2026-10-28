import { expect, it } from "vitest";

import { documentSchema, pinnedRepositoryIds } from "./document.js";

const commit = (digit: string) => digit.repeat(40);

it("finds every repository a reference's own pins name, Markdown links included", () => {
  const document = documentSchema.parse([
    {
      id: "section",
      type: "section",
      title: "Two repositories",
      children: [
        {
          id: "prose",
          type: "markdown",
          markdown: "See [the entry](review-source:head/src/a.ts#L1).",
          pins: { repositoryId: "linked", head: commit("a") },
        },
        {
          id: "peek",
          type: "code_peek",
          source: "head/lib.ts#L1-L2",
          pins: { repositoryId: "peeked", head: commit("b") },
        },
        {
          id: "plain",
          type: "code_peek",
          source: "head/lib.ts#L3",
        },
      ],
    },
  ]);

  expect(pinnedRepositoryIds(document)).toEqual(new Set(["linked", "peeked"]));
});
