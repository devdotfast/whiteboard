// Print the update feed manifest for one Windows installer.
//
//   node scripts/windows-update-manifest.mjs --version 1.2.3 --commit <sha> <setup.exe>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const {
  values: { version, commit },
  positionals: [installer],
} = parseArgs({
  options: { version: { type: "string" }, commit: { type: "string" } },
  allowPositionals: true,
});

if (!version || !commit || !installer) {
  console.error(
    "usage: windows-update-manifest.mjs --version <semver> --commit <sha> <setup.exe>",
  );
  process.exit(2);
}

const now = new Date();

const manifest = {
  version,
  commit,
  url: `https://update.dev.fast/releases/${version}/win32-x64/${path.basename(installer)}`,
  sha256hash: createHash("sha256").update(readFileSync(installer)).digest("hex"),
  name: version,
  pub_date: now.toISOString(),
  timestamp: now.getTime(),
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
