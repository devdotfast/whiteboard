import { z } from "zod";

import { call_stack_diff } from "./call_stack_diff.js";
import { type CalloutBlock, callout, calloutSchema } from "./callout.js";
import { code } from "./code.js";
import { code_peek } from "./code_peek.js";
import { database_lens } from "./database_lens.js";
import type { BlockDefinition } from "./definition.js";
import { divider } from "./divider.js";
import { flow_diagram } from "./flow_diagram.js";
import { image } from "./image.js";
import { markdown } from "./markdown.js";
import { type SectionBlock, section, sectionSchema } from "./section.js";
import { sequence } from "./sequence.js";
import { software_map } from "./software_map.js";
import { trace_quote } from "./trace_quote.js";
import { type TutorialBlock, tutorial, tutorialSchema } from "./tutorial.js";

/** Leaf kinds share one discriminated union so unknown types read as they always have. */
export const leafSchema = z.discriminatedUnion("type", [
  markdown.schema,
  code.schema,
  divider.schema,
  code_peek.schema,
  sequence.schema,
  call_stack_diff.schema,
  database_lens.schema,
  image.schema,
  trace_quote.schema,
  software_map.schema,
  flow_diagram.schema,
]);

export type LeafBlock = z.infer<typeof leafSchema>;

export type Block = LeafBlock | SectionBlock | CalloutBlock | TutorialBlock;

export type BlockType = Block["type"];

export type Definitions = {
  [K in BlockType]: BlockDefinition<Extract<Block, { type: K }>>;
};

/** Every block kind, keyed by type. A kind without a definition is a compile error. */
export const blocks = {
  markdown,
  code,
  divider,
  code_peek,
  sequence,
  call_stack_diff,
  database_lens,
  image,
  trace_quote,
  software_map,
  flow_diagram,
  section,
  callout,
  tutorial,
} satisfies Definitions;

/** Discriminated by type, so a malformed block reports its own kind's
 * issues rather than every kind's. */
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", blockKindSchemas()),
);

/** Each block kind's schema, for unions that add kinds of their own. Read
 * lazily: the container modules import this one. */
export const blockKindSchemas = () =>
  [leafSchema, sectionSchema, calloutSchema, tutorialSchema] as const;

function checkBlock<K extends BlockType>(
  type: K,
  block: Extract<Block, { type: K }>,
): void {
  const definition: Definitions[K] = blocks[type];
  definition.check?.(block);
}

/** Relationships not expressible in a field schema. Sources/resources are checked by host providers. */
export function checkReferences(document: Block[]): void {
  const visit = (block: Block) => {
    checkBlock(block.type, block);

    if ("children" in block) block.children.forEach(visit);
  };

  document.forEach(visit);
}
