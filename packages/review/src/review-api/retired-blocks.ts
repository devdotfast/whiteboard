// Block kinds agents no longer write: a diagram draws what each of them did.
// Boards that have them keep rendering them, and a person, or an agent
// fixing one, can still update or remove one; only new ones are refused.

import {
  type Block,
  type Edit,
  ReviewInputError,
  elements,
} from "@dev.fast/whiteboard-document";

export const RETIRED_BLOCK_TYPES = [
  "animation",
  "clip",
  "flow_diagram",
  "sequence",
  "call_stack_diff",
] as const;

const retired = new Set<string>(RETIRED_BLOCK_TYPES);

/** Refuses an agent's edit that adds a retired kind: an insert, or a
 * replace that turns a block into one. */
export function refuseRetiredBlocks(edit: Edit, document: Block[]): void {
  if (!("content" in edit)) return;

  const target =
    edit.type === "replace"
      ? elements(document).find((element) => element.id === edit.targetId)
      : undefined;

  const added = elements([edit.content]).find(
    (element) => retired.has(element.type) && element.type !== target?.type,
  );

  if (added)
    throw new ReviewInputError(
      `New ${added.type} components are retired: draw it as a diagram instead, with nodes, wires, steps and code links. Read session_get_instructions({topic:"diagram"}) first. Existing ${added.type} components can still be updated or removed.`,
      409,
    );
}
