import { z } from "zod";

import { type BlockDefinition, defineBlock } from "./definition.js";

type TutorialContent =
  | { kind: "keymap" }
  | { kind: "view"; view: "diff"; label: string };

export type TutorialBlock = { id?: string; type: "tutorial" } & TutorialContent;

export const tutorialSchema = z.discriminatedUnion("kind", [
  defineBlock("tutorial", { kind: z.literal("keymap") }),
  defineBlock("tutorial", {
    kind: z.literal("view"),
    view: z.literal("diff"),
    label: z.string(),
  }),
]);

export const tutorial: BlockDefinition<TutorialBlock> = {
  type: "tutorial",
  schema: tutorialSchema,
};
