import { fileURLToPath } from "node:url";

import {
  buildReviewDebPackage,
  buildReviewRpmPackage,
  prepareReviewArchPackage,
  prepareReviewDebPackage,
  prepareReviewNixPackage,
  prepareReviewRpmPackage,
} from "../code-oss/build/linux/review-package.ts";

const root = fileURLToPath(new URL("../code-oss", import.meta.url));

const format = process.argv[2];

if (!["rpm", "deb", "arch", "nixos", "all"].includes(format))
  throw new Error("Unknown package format");

if (format === "rpm" || format === "all") {
  await prepareReviewRpmPackage(root, "x86_64");
  await buildReviewRpmPackage(root, "x86_64");
}

if (format === "deb" || format === "all") {
  await prepareReviewDebPackage(root, "amd64");
  await buildReviewDebPackage(root, "amd64");
}

if (format === "arch" || format === "all") await prepareReviewArchPackage(root);

if (format === "nixos" || format === "all") await prepareReviewNixPackage(root);
