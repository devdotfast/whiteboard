#!/usr/bin/env node
// Regenerates code-oss/extensions/review-grammars from review-grammars.manifest.mjs
// and the pinned tm-grammars package.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { grammars as tmGrammars } from "tm-grammars";

import { reviewGrammars } from "./review-grammars.manifest.mjs";

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXTENSION_DIR = path.join(
  APP_DIR,
  "code-oss",
  "extensions",
  "review-grammars",
);

const require = createRequire(import.meta.url);

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
};

const metadata = (name) => {
  const found = tmGrammars.find((grammar) => grammar.name === name);

  if (!found) {
    throw new Error(`tm-grammars has no grammar named "${name}"`);
  }

  return found;
};

fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });

const languages = [];

const grammars = [];

const registrations = [];

for (const entry of reviewGrammars) {
  const language = {
    id: entry.language,
    ...(entry.aliases && { aliases: entry.aliases }),
    ...(entry.extensions && { extensions: entry.extensions }),
    ...(entry.filenames && { filenames: entry.filenames }),
  };

  if (entry.grammar) {
    const meta = metadata(entry.grammar);
    const syntax = `./syntaxes/${entry.grammar}.tmLanguage.json`;
    const configuration = `./language-configuration/${entry.language}.json`;

    writeJson(
      path.join(EXTENSION_DIR, syntax),
      require(`tm-grammars/grammars/${entry.grammar}.json`),
    );
    writeJson(path.join(EXTENSION_DIR, configuration), {
      comments: entry.comments,
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"', notIn: ["string"] },
      ],
      surroundingPairs: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
        ['"', '"'],
      ],
    });

    language.configuration = configuration;
    grammars.push({
      language: entry.language,
      scopeName: meta.scopeName,
      path: syntax,
    });

    const license = entry.license ?? meta.license;

    if (!license || license === "NOASSERTION" || /GPL/.test(license)) {
      throw new Error(
        `${entry.grammar} has license "${license}"; set a permissive one in the manifest`,
      );
    }

    const [, repository] = meta.source.match(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
    );

    registrations.push({
      component: {
        type: "git",
        git: {
          name: repository,
          repositoryUrl: `https://github.com/${repository}`,
          commitHash: meta.sha,
        },
      },
      license,
    });
  }

  languages.push(language);
}

writeJson(path.join(EXTENSION_DIR, "package.json"), {
  name: "review-grammars",
  displayName: "%displayName%",
  description: "%description%",
  version: "10.0.0",
  publisher: "vscode",
  license: "MIT",
  engines: { vscode: "*" },
  categories: ["Programming Languages"],
  contributes: { languages, grammars },
});

writeJson(path.join(EXTENSION_DIR, "package.nls.json"), {
  displayName: "Whiteboard Language Basics",
  description:
    "Provides syntax highlighting for languages Code OSS does not ship.",
});

writeJson(path.join(EXTENSION_DIR, "cgmanifest.json"), {
  registrations,
  version: 1,
});

fs.writeFileSync(
  path.join(EXTENSION_DIR, ".vscodeignore"),
  "cgmanifest.json\n",
);

