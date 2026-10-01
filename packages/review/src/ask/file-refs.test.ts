import { parseFileRef, resolveFileRefs } from "@review/ask/file-refs.js";
import { expect, it } from "vitest";

it("reads a file and line from the ways agents write them", () => {
  expect(parseFileRef("src/app.ts")).toEqual({ path: "src/app.ts" });
  expect(parseFileRef("src/app.ts:42")).toEqual({
    path: "src/app.ts",
    line: 42,
  });
  expect(parseFileRef("./src/app.ts:42:7")).toEqual({
    path: "src/app.ts",
    line: 42,
  });
  expect(parseFileRef("/checkout/src/app.ts#L42-L50")).toEqual({
    path: "/checkout/src/app.ts",
    line: 42,
  });
  expect(parseFileRef("file:///checkout/my%20app.ts")).toBeUndefined();
  expect(parseFileRef("file:///checkout/app.ts")).toEqual({
    path: "/checkout/app.ts",
  });
  expect(parseFileRef("esbuild.mts")).toEqual({ path: "esbuild.mts" });
});

it("leaves code that is not a path alone", () => {
  const codes = [
    "pnpm build",
    "https://example.com/app.ts",
    "--watch",
    "vscode",
    "1.5",
    "Array<string>",
    "",
  ];

  expect(codes.filter((code) => parseFileRef(code))).toEqual([]);
});

it("resolves a path to the one file in the checkout it can name", () => {
  const files = [
    "package.json",
    "src/app.ts",
    "extensions/review-files/package.json",
    "extensions/review-files/src/extension.ts",
    "extensions/other/src/extension.ts",
    "extensions/review-files/esbuild.mts",
  ];

  const resolved = resolveFileRefs(
    "/checkout",
    files,
    [
      "src/app.ts",
      "/checkout/src/app.ts",
      "b/src/app.ts",
      "esbuild.mts",
      "src/extension.ts",
      "package.json",
      "/elsewhere/src/app.ts",
      "src/missing.ts",
    ],
    // What the agent's tools read settles which extension it means.
    ["sed", "-n", "1,20p", "extensions/review-files/src/extension.ts"],
  );

  expect(Object.fromEntries(resolved)).toEqual({
    "src/app.ts": "src/app.ts",
    "/checkout/src/app.ts": "src/app.ts",
    "b/src/app.ts": "src/app.ts",
    "esbuild.mts": "extensions/review-files/esbuild.mts",
    "src/extension.ts": "extensions/review-files/src/extension.ts",
    // The root's own file, though others end the same way.
    "package.json": "package.json",
  });
});

it("resolves nothing when a path could be several files the agent never touched", () => {
  const files = ["a/src/extension.ts", "b/src/extension.ts"];

  expect(resolveFileRefs("/checkout", files, ["src/extension.ts"]).size).toBe(
    0,
  );
});
