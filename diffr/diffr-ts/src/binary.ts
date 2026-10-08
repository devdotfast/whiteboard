import { createRequire } from "node:module";

/** The diffr executable from the installed platform package, if npm installed one for this machine. */
export function diffrBinaryPath(): string | undefined {
  const name = process.platform === "win32" ? "diffr.exe" : "diffr";
  try {
    // Workspace consumers see local TypeScript changes, but the native binary
    // remains version-pinned in package.json. Rust edits need a new platform
    // build until development builds can opt into a local diffr executable.
    // Resolve from this package's own directory, which also holds when a bundler inlines it.
    const self = createRequire(import.meta.url).resolve("@dev.fast/diffr/package.json");
    return createRequire(self).resolve(`@dev.fast/diffr-${process.platform}-${process.arch}/${name}`);
  } catch {
    return undefined;
  }
}
