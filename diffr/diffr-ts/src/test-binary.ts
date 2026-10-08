import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function diffrBinary(): string {
  const candidate =
    process.env.DIFFR_BINARY ?? resolve(import.meta.dirname, "../../target/debug/diffr");
  if (!existsSync(candidate)) {
    throw new Error(
      `${candidate} is missing. Run \`cargo build --locked\` at the repository root or set DIFFR_BINARY.`,
    );
  }
  return candidate;
}

export const repositoryRoot = resolve(import.meta.dirname, "../..");
