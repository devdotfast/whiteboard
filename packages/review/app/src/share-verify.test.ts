import { expect, it } from "vitest";

import { verifySharedBoard } from "./share-verify";
import { share } from "./shared-board-test-utils";

it("passes a share whose objects match their digests", async () => {
  const sealed = await share("bug-report-dialog");

  await expect(verifySharedBoard(sealed)).resolves.toEqual(sealed);
});

it("refuses an object changed after sealing", async () => {
  const sealed = await share("bug-report-dialog");
  const [id, bytes] = [...sealed.objects][0]!;
  const changed = new Uint8Array(bytes);
  changed[0] ^= 1;

  await expect(
    verifySharedBoard({
      ...sealed,
      objects: new Map([...sealed.objects, [id, changed]]),
    }),
  ).rejects.toThrow(`Shared object ${id} is missing or corrupt.`);
});

it("refuses a share missing an object", async () => {
  const sealed = await share("bug-report-dialog");
  const [id] = [...sealed.objects.keys()];

  await expect(
    verifySharedBoard({
      ...sealed,
      objects: new Map([...sealed.objects].filter(([key]) => key !== id)),
    }),
  ).rejects.toThrow(`Shared object ${id} is missing or corrupt.`);
});

it("refuses a manifest that is not review-share/1", async () => {
  const sealed = await share("bug-report-dialog");

  await expect(
    verifySharedBoard({
      ...sealed,
      manifest: { ...sealed.manifest, format: "review-share/2" },
    }),
  ).rejects.toThrow(/review-share\/1/);
});
