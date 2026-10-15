// Moves a platform's latest aliases (download links, update manifest) to a
// release, unless they already name a newer one. Each argument is
// FILE=KEY[=DOWNLOAD_NAME]; the last key is the pointer that decides, written
// last and only if nobody moved it since it was read. Sets the step output
// moved=true when it moved them.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CONTENT_TYPES = {
  ".dmg": "application/x-apple-diskimage",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".json": "application/json",
  ".zip": "application/zip",
};

export function versionOrder(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d{8})\.(\d+))?$/.exec(
    version,
  );

  if (!match) throw new Error(`${version} is not X.Y.Z or X.Y.Z-preview.YYYYMMDD.N`);

  return match.slice(1).map((part) => Number(part ?? 0));
}

export function compareVersions(a, b) {
  const left = versionOrder(a);
  const right = versionOrder(b);

  for (let i = 0; i < left.length; i++)
    if (left[i] !== right[i]) return left[i] - right[i];

  return 0;
}

function s3api(...args) {
  try {
    const out = execFileSync("aws", ["s3api", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return out.trim() ? JSON.parse(out) : {};
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim());
  }
}

const notFound = (error) => /Not Found|NoSuchKey|\(404\)/.test(error.message);

export function promoteAliases({ bucket, version, objects, aws = s3api }) {
  versionOrder(version);
  const pointer = objects.at(-1);
  let condition = ["--if-none-match", "*"];

  try {
    const head = aws("head-object", "--bucket", bucket, "--key", pointer.key);
    let current = head.Metadata?.version;

    // Manifests written before aliases carried a version still name it.
    if (!current && pointer.key.endsWith(".json")) {
      const dir = mkdtempSync(path.join(tmpdir(), "release-alias-"));

      try {
        const file = path.join(dir, "current.json");
        aws("get-object", "--bucket", bucket, "--key", pointer.key, file);
        const manifest = JSON.parse(readFileSync(file, "utf8"));

        // macOS manifests carry it as productVersion, Windows ones as version.
        current = manifest.productVersion ?? manifest.version;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    if (current && compareVersions(version, current) < 0) {
      console.log(`${pointer.key} names ${current}, newer than ${version}; leaving it in place.`);

      return false;
    }

    condition = ["--if-match", head.ETag];
  } catch (error) {
    if (!notFound(error)) throw error;
  }

  for (const object of objects) {
    const disposition = object.downloadName
      ? ["--content-disposition", `attachment; filename="${object.downloadName}"`]
      : [];

    aws(
      "put-object",
      "--bucket", bucket,
      "--key", object.key,
      "--body", object.file,
      "--content-type", CONTENT_TYPES[path.extname(object.key)] ?? "application/octet-stream",
      "--metadata", `version=${version}`,
      ...disposition,
      ...(object === pointer ? condition : []),
    );
  }

  console.log(`Moved ${objects.map((object) => object.key).join(", ")} to ${version}.`);

  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: { bucket: { type: "string" }, version: { type: "string" } },
    allowPositionals: true,
  });

  if (!values.bucket || !values.version || positionals.length === 0)
    throw new Error("usage: promote-release-aliases.mjs --bucket B --version V FILE=KEY[=DOWNLOAD_NAME]...");

  const objects = positionals.map((spec) => {
    const [file, key, downloadName] = spec.split("=");

    return { file, key, downloadName };
  });

  const moved = promoteAliases({ bucket: values.bucket, version: values.version, objects });

  if (moved && process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, "moved=true\n");
}
