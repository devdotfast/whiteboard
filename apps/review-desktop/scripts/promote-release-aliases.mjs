// Moves a platform's latest aliases (download links, update manifest) to a
// release, unless they already name a newer one. Each argument is
// SOURCE=KEY[=DOWNLOAD_NAME], where SOURCE is a local file or s3:<key> for an
// object already in the bucket, copied without a re-upload. The last key is the
// pointer that decides, a local file; the other aliases follow it. Sets the
// step output moved=true when it moved them.
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

const preconditionFailed = (error) => /PreconditionFailed|\(412\)/.test(error.message);

const VERSION_IN_NAME = /\d+\.\d+\.\d+(?:-preview\.\d{8}\.\d+)?/;

// The pointer's current version and ETag, or undefined if it does not exist.
function readPointer(aws, bucket, key) {
  let head;

  try {
    head = aws("head-object", "--bucket", bucket, "--key", key);
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }

  // Aliases written before they carried a version still name it, in their
  // download name or, for a manifest, its productVersion.
  let current = head.Metadata?.version ?? VERSION_IN_NAME.exec(head.ContentDisposition ?? "")?.[0];

  if (!current && key.endsWith(".json")) {
    const dir = mkdtempSync(path.join(tmpdir(), "release-alias-"));

    try {
      const file = path.join(dir, "current.json");

      aws("get-object", "--bucket", bucket, "--key", key, file);
      const manifest = JSON.parse(readFileSync(file, "utf8"));

      // macOS manifests carry it as productVersion, Windows ones as version.
      current = manifest.productVersion ?? manifest.version;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return { current, etag: head.ETag };
}

function write(aws, bucket, version, object, condition = []) {
  const disposition = object.downloadName
    ? ["--content-disposition", `attachment; filename="${object.downloadName}"`]
    : [];

  const source = object.file.startsWith("s3:")
    ? ["copy-object", "--copy-source", `${bucket}/${object.file.slice(3)}`, "--metadata-directive", "REPLACE"]
    : ["put-object", "--body", object.file];

  aws(
    source[0],
    "--bucket", bucket,
    "--key", object.key,
    ...source.slice(1),
    "--content-type", CONTENT_TYPES[path.extname(object.key)] ?? "application/octet-stream",
    "--metadata", `version=${version}`,
    ...disposition,
    ...condition,
  );
}

// The pointer is written first and only if nobody moved it since it was read,
// so a run that loses a race re-reads it instead of overwriting the others.
export function promoteAliases({ bucket, version, objects, aws = s3api }) {
  versionOrder(version);
  const pointer = objects.at(-1);

  if (pointer.file.startsWith("s3:")) throw new Error("The pointer must be a local file");

  for (let attempt = 1; ; attempt++) {
    const state = readPointer(aws, bucket, pointer.key);

    if (state?.current && compareVersions(version, state.current) < 0) {
      console.log(`${pointer.key} names ${state.current}, newer than ${version}; leaving it in place.`);

      return false;
    }

    try {
      write(aws, bucket, version, pointer, state ? ["--if-match", state.etag] : ["--if-none-match", "*"]);
      break;
    } catch (error) {
      if (!preconditionFailed(error) || attempt === 3) throw error;
    }
  }

  for (const object of objects.slice(0, -1)) write(aws, bucket, version, object);

  console.log(`Moved ${objects.map((object) => object.key).join(", ")} to ${version}.`);

  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: { bucket: { type: "string" }, version: { type: "string" } },
    allowPositionals: true,
  });

  if (!values.bucket || !values.version || positionals.length === 0)
    throw new Error("usage: promote-release-aliases.mjs --bucket B --version V SOURCE=KEY[=DOWNLOAD_NAME]...");

  const objects = positionals.map((spec) => {
    const [file, key, downloadName] = spec.split("=");

    return { file, key, downloadName };
  });

  const moved = promoteAliases({ bucket: values.bucket, version: values.version, objects });

  if (moved && process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, "moved=true\n");
}
