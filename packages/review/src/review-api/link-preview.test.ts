import { blockSchema } from "@review/review-api/blocks/index.js";
import { boardLinkPreview } from "@review/review-api/link-preview.js";
import { expect, it } from "vitest";
import { z } from "zod";

const document = z.array(blockSchema).parse([
  {
    id: "flow",
    type: "flow_diagram",
    title: "Before a save",
    nodes: [{ key: "a", label: "Diff" }],
    edges: [],
  },
  {
    id: "design",
    type: "section",
    title: "Design",
    children: [
      {
        id: "lead",
        type: "markdown",
        markdown: "## Why\n\nTracked files only.\n\n- git add -N\n- jj tracks",
      },
      {
        id: "snippet",
        type: "code",
        language: "ts",
        text: Array.from({ length: 9 }, (_, line) => `line ${line + 1}`).join(
          "\n",
        ),
      },
    ],
  },
]);

it("previews a block under its section: prose, code's first lines, a figure's title", () => {
  expect(boardLinkPreview(document, "lead")).toMatchObject({
    section: "Design",
  });

  const code = boardLinkPreview(document, "snippet").code?.lines ?? [];

  expect(code[0]).toBe("line 1");
  expect(code).not.toContain("line 9");
  expect(boardLinkPreview(document, "flow")).toEqual({
    figure: { type: "flow_diagram", title: "Before a save" },
  });
  expect(boardLinkPreview(document, "gone")).toEqual({});
});
