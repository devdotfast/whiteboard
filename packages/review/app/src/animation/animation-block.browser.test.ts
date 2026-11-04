import { describe, expect, it } from "vitest";

import { schemeOf } from "./animation-block";

describe("schemeOf", () => {
  it("takes the host's own light or dark palette", () => {
    expect(schemeOf("dark")).toBe("dark");
    expect(schemeOf("light")).toBe("light");
    expect(schemeOf("normal")).toBe("light");
  });

  it("follows the reader's preference where the host names both", () => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;

    expect(schemeOf("light dark")).toBe(dark ? "dark" : "light");
    expect(schemeOf("dark light")).toBe(dark ? "dark" : "light");
  });
});
