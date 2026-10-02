import { describe, expect, it } from "vitest";

import { defineSoftwareMap } from "./software-map-model";
import {
  softwareModelData,
  softwareModelDataSchema,
} from "./software-map-model";

const model = defineSoftwareMap({
  systems: {
    api: {
      label: "API",
      containers: {
        server: {
          label: "Server",
          components: {
            handler: { label: "Handler", coverage: { files: ["src/a.ts"] } },
          },
        },
      },
    },
  },
  relationships: [{ kind: "semantic", from: "api", to: "api.server" }],
});

describe("softwareModelDataSchema", () => {
  it("round-trips a normalized model through JSON", () => {
    const data = softwareModelData(model);
    expect(
      softwareModelDataSchema.parse(JSON.parse(JSON.stringify(data))),
    ).toEqual(data);
  });
});
