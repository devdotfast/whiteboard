import { expect, it } from "vitest";

import { VersionCache } from "./version-cache.js";

it("derives a version once, until newer work pushes it out", () => {
  const derived: string[] = [];

  const cache = new VersionCache(
    (input: { reviewId: string; version: number }) => {
      derived.push(`${input.reviewId}@${input.version}`);

      return { input };
    },
    { capacity: 2 },
  );

  const first = cache.get({ reviewId: "a", version: 1 });

  expect(cache.get({ reviewId: "a", version: 1 })).toBe(first);
  cache.get({ reviewId: "a", version: 2 });
  // Reading a version again keeps it.
  cache.get({ reviewId: "a", version: 1 });
  cache.get({ reviewId: "b", version: 1 });
  cache.get({ reviewId: "a", version: 1 });
  cache.get({ reviewId: "a", version: 2 });
  expect(derived).toEqual(["a@1", "a@2", "b@1", "a@2"]);
});

it("tells apart content a version alone does not pin down", () => {
  let derivations = 0;

  const cache = new VersionCache(
    (input: { reviewId: string; version: number; text: string }) => {
      derivations++;

      return input.text.toUpperCase();
    },
    { capacity: 4, key: (input) => `${input.reviewId}:${input.text}` },
  );

  expect(cache.get({ reviewId: "a", version: 1, text: "one" })).toBe("ONE");
  expect(cache.get({ reviewId: "a", version: 1, text: "two" })).toBe("TWO");
  expect(cache.get({ reviewId: "a", version: 1, text: "one" })).toBe("ONE");
  expect(derivations).toBe(2);
});
