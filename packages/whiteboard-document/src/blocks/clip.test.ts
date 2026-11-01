import { describe, expect, it } from "vitest";

import { checkReferences, documentSchema } from "../index.js";
import { ReviewInputError } from "../input-error.js";

const clip = {
  type: "clip",
  title: "A request",
  html: "<script>whiteboard.clip().marker('sent').marker('done');</script>",
  markers: [
    { key: "sent", title: "Sent", code: ["send"] },
    { key: "done", title: "Done", caption: "It lands." },
  ],
  scenarios: [
    { key: "fast", label: "Fast" },
    { key: "slow", label: "Slow" },
  ],
  code: { send: "head/send.ts#L1" },
};

describe("clip", () => {
  it("parses with its markers and scenarios, and passes its check", () => {
    const [block] = documentSchema.parse([clip]);

    expect(block).toMatchObject({
      type: "clip",
      markers: clip.markers,
      scenarios: clip.scenarios,
      height: "auto",
    });
    expect(() => checkReferences([block!])).not.toThrow();
  });

  it("refuses frame fields on a marker", () => {
    expect(() =>
      documentSchema.parse([
        { ...clip, markers: [{ key: "sent", title: "Sent", duration: 900 }] },
      ]),
    ).toThrow(/duration/);
  });

  it("rejects duplicate marker keys", () => {
    const [block] = documentSchema.parse([
      {
        ...clip,
        markers: [
          { key: "sent", title: "Sent" },
          { key: "sent", title: "Again" },
        ],
      },
    ]);

    expect(() => checkReferences([block!])).toThrow(
      new ReviewInputError("Clip marker keys must be unique within the clip."),
    );
  });

  it("rejects a marker naming code the clip does not", () => {
    const [block] = documentSchema.parse([
      { ...clip, markers: [{ key: "sent", title: "Sent", code: ["ghost"] }] },
    ]);

    expect(() => checkReferences([block!])).toThrow(
      new ReviewInputError(
        'Marker "sent" lists code "ghost", which the clip\'s code does not name.',
      ),
    );
  });

  it("rejects duplicate scenario keys", () => {
    const [block] = documentSchema.parse([
      {
        ...clip,
        scenarios: [
          { key: "fast", label: "Fast" },
          { key: "fast", label: "Also fast" },
        ],
      },
    ]);

    expect(() => checkReferences([block!])).toThrow(
      new ReviewInputError(
        "Clip scenario keys must be unique within the clip.",
      ),
    );
  });
});
