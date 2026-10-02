import sharp from "sharp";
import { expect, it } from "vitest";

import { decodeImage } from "./image-decode.js";

it.each(["png", "jpeg", "webp"] as const)(
  "re-encodes %s as PNG with the original dimensions",
  async (format) => {
    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "red" },
    })
      .toFormat(format)
      .toBuffer();

    expect(await sharp(await decodeImage(input)).metadata()).toMatchObject({
      format: "png",
      width: 3,
      height: 2,
    });
  },
);
