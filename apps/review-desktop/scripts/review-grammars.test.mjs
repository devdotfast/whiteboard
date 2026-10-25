import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXTENSIONS_DIR = path.join(APP_DIR, "code-oss", "extensions");

const GUESS_LANGUAGE = path.join(
  APP_DIR,
  "../../diffr/crates/diffr-core/src/parse/guess_language.rs",
);

const KNOWN_GAPS = new Set([
  // GPL grammars.
  "*.ada",
  "*.adb",
  "*.ads",
  "*.rkt",
  // Grammar too large.
  "*.el",
  ".emacs",
  "_emacs",
  "Cask",
  // No TextMate grammar.
  "*.janet",
  "*.jdn",
  "*.smali",
  "*.dts",
  "*.dtsi",
  "*.dtso",
  "*.its",
  "*.nhx",
  "*.nwk",
  "*.nh",
  // Names other formats claim.
  "*.aux",
  "*.d",
  "*.es",
  "*.ice",
  "*.rd",
  "*.spec",
  "*.ui",
  "*.webapp",
  "*.workflow",
  "*.JSON-tmLanguage",
  "*.cgi",
  "*.fcgi",
  "*.tool",
  "*.sh.in",
  "*.joke",
  "*.joker",
  "9fs",
  "man",
  "login",
  ".login",
  "profile",
  "cshrc",
  "kshrc",
  "bashrc",
  "bash_aliases",
  "bash_logout",
  "bash_profile",
  ".bash_history",
  "DEPS",
  "expr-dist",
  "mcmod.info",
  ".auto-changelog",
  ".htmlhintrc",
  ".imgbotconfig",
  "Makefile.frag",
  "Makefile*.in",
  "Makefile.wat",
  "makefile.sco",
]);

function diffrGlobs() {
  const source = readFileSync(GUESS_LANGUAGE, "utf8");
  const body = source.slice(source.indexOf("pub fn language_globs"));

  return [
    ...body.slice(0, body.indexOf("\n}\n")).matchAll(/=> &\[([^\]]*)\]/g),
  ].flatMap((list) => [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function highlightedAssociations() {
  const languages = [];
  const colored = new Set();

  for (const name of readdirSync(EXTENSIONS_DIR)) {
    let contributes;

    try {
      ({ contributes = {} } = JSON.parse(
        readFileSync(path.join(EXTENSIONS_DIR, name, "package.json"), "utf8"),
      ));
    } catch {
      continue;
    }

    languages.push(...(contributes.languages ?? []));

    for (const grammar of contributes.grammars ?? []) {
      colored.add(grammar.language);
    }
  }

  return languages.filter((language) => colored.has(language.id));
}

test("Code OSS colors every file diffr parses, apart from known gaps", () => {
  const associations = highlightedAssociations();

  const colors = (glob) => {
    const file = glob.replaceAll("*", "x");
    const lower = file.toLowerCase();

    return associations.some(
      (a) =>
        a.extensions?.some((ext) => lower.endsWith(ext.toLowerCase())) ||
        a.filenames?.some((name) => name.toLowerCase() === lower) ||
        a.filenamePatterns?.some((pattern) => path.matchesGlob(file, pattern)),
    );
  };

  const uncolored = diffrGlobs().filter(
    (glob) => !KNOWN_GAPS.has(glob) && !colors(glob),
  );

  assert.deepEqual(uncolored, []);
});
