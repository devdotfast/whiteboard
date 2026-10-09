import { expect, test } from "bun:test";
import { themeConfig } from "@diffr/viewer/theme/palette";
import { themesFromConfig } from "./theme";
test("the theme set follows diffr's config and errors on a missing section", () => {
  expect(themeConfig({ theme: { name: "gruvbox", path: null } })).toEqual({ name: "gruvbox", path: null });
  expect(() => themeConfig({ folds: {} })).toThrow("theme section");
  const set = themesFromConfig({ name: "gruvbox", path: null });
  expect(set.initial.name).toBe("gruvbox");
  expect(set.dark.name).toBe("default-dark");
  expect(set.light.name).toBe("default-light");
  expect(() => themesFromConfig({ name: "nope", path: null })).toThrow("Unknown theme");
  expect(() => themesFromConfig({ name: "default-dark", path: "/nonexistent/theme.toml" })).toThrow();
});
