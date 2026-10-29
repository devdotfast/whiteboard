import { STAGE_THEME, STAGE_VARIABLES } from "@review/animation-stage-kit";
import { expect, it } from "vitest";

import { SCALE } from "./stage-scale";

it("names in whiteboard.css exactly the variables a stage is given", () => {
  const listed = STAGE_VARIABLES.flatMap(([, names]) => names).sort();

  // The kit sets --wb-duration itself; the canvas sends the rest.
  const given = [
    ...Object.keys(SCALE),
    ...Object.keys(STAGE_THEME),
    "duration",
  ].sort();

  expect(listed).toEqual(given);
});
