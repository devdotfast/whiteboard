import type { JsonObject } from "@dev.fast/json";
import { describe, expect, it } from "vitest";

import { checkReferences, documentSchema } from "../index.js";

const diagram = {
  type: "diagram",
  title: "Orders",
  script: 'wb.node({ id: "api", kind: "container", label: "API" });',
  frames: [
    {
      key: "ask",
      title: "Ask",
      code: ["route"],
      moves: [{ from: "web", to: "api", label: "POST" }],
    },
    { key: "answer", title: "Answer" },
  ],
  scenarios: [
    { key: "happy", label: "Happy", frames: ["ask", "answer"] },
    { key: "short", label: "Short", frames: ["ask"] },
  ],
  code: {
    route: { source: "head/api.ts#L4-L9" },
  },
};

/** Parses and checks the diagram with `fields` set and `drop` left out. */
const check =
  (fields: JsonObject, drop: string[] = []) =>
  () =>
    checkReferences(
      documentSchema.parse([
        Object.fromEntries(
          Object.entries({ ...diagram, ...fields }).filter(
            ([key]) => !drop.includes(key),
          ),
        ),
      ]),
    );

describe("diagram", () => {
  it("parses with its frames, moves and scenarios, and passes its check", () => {
    const [block] = documentSchema.parse([diagram]);

    expect(block).toMatchObject({
      type: "diagram",
      frames: diagram.frames,
      code: diagram.code,
    });
    expect(() => checkReferences([block!])).not.toThrow();
  });

  it("is a still drawing without frames or a timeline", () => {
    expect(check({}, ["frames", "scenarios"])).not.toThrow();
  });

  it("draws from markup, a script or both, but needs one", () => {
    expect(check({ html: "<ul><li>One</li></ul>" }, ["script"])).not.toThrow();
    expect(check({ html: "<p>Two</p>" })).not.toThrow();
    expect(check({}, ["script"])).toThrow(/needs html, a script, or both/);
  });

  it("refuses frames and a timeline together", () => {
    expect(
      check({
        timeline: { chapters: [{ key: "go", title: "Go", duration: 500 }] },
      }),
    ).toThrow(/frames or a timeline/);
  });

  it("refuses a frame or chapter naming code it does not define", () => {
    expect(
      check(
        {
          frames: [{ key: "ask", title: "Ask", code: ["missing"] }],
        },
        ["scenarios"],
      ),
    ).toThrow(/missing/);
    expect(
      check(
        {
          timeline: {
            chapters: [
              { key: "go", title: "Go", duration: 500, code: ["gone"] },
            ],
          },
        },
        ["frames", "scenarios"],
      ),
    ).toThrow(/gone/);
  });

  it("refuses scenarios without frames, or naming a frame it lacks", () => {
    expect(check({}, ["frames"])).toThrow(/give it frames/);
    expect(
      check({
        scenarios: [
          { key: "a", label: "A", frames: ["ask"] },
          { key: "b", label: "B", frames: ["nowhere"] },
        ],
      }),
    ).toThrow(/nowhere/);
  });

  it("refuses duplicate frame keys, and labels on only some frames", () => {
    expect(
      check(
        {
          frames: [
            { key: "ask", title: "Ask" },
            { key: "ask", title: "Again" },
          ],
        },
        ["scenarios"],
      ),
    ).toThrow(/unique/);
    expect(
      check(
        {
          frames: [
            { key: "ask", title: "Ask", label: "ASK" },
            { key: "answer", title: "Answer" },
          ],
        },
        ["scenarios"],
      ),
    ).toThrow(/label/);
  });
});
