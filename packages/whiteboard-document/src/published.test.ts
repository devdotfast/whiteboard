import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type BlockType,
  componentReference,
  publishedEdits,
  writableBlockTypes,
} from "./index.js";

const hosted: BlockType[] = writableBlockTypes.filter(
  (type) => type !== "image" && type !== "database_lens",
);

const insert = (type: string) => ({ type: "insert", content: { type } });

describe("publishedEdits", () => {
  it("names only the selected block types and every unit type", () => {
    const schema = publishedEdits(hosted);

    for (const type of ["markdown", "step", "flow_node", "flow_edge"])
      expect(schema.safeParse(insert(type)).success).toBe(true);

    for (const type of ["image", "database_lens"]) {
      expect(schema.safeParse(insert(type)).success).toBe(false);
      expect(JSON.stringify(z.toJSONSchema(schema))).not.toContain(`"${type}"`);
    }
  });
});

describe("componentReference", () => {
  it("leaves out unselected blocks and their units", () => {
    const reference = componentReference(hosted);

    expect(reference).toContain("- markdown {");
    expect(reference).not.toContain("- image {");
    expect(reference).not.toContain("- database_lens {");
    expect(reference).not.toContain("- store {");
    expect(reference).not.toContain("- useCase {");
  });
});
