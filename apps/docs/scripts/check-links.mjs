import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "parse5";

const root = path.resolve(process.argv[2] || "dist");

const base =
  `/${(process.env.DOCS_BASE || "").split("/").filter(Boolean).join("/")}/`.replace(
    /^\/\//,
    "/",
  );

const origin = new URL(process.env.DOCS_SITE || "https://docs.example.invalid")
  .origin;

const files = new Set();

const pages = new Map();

const failures = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);

    if (entry.isDirectory()) await collect(filename);
    else files.add(path.relative(root, filename).split(path.sep).join("/"));
  }
}

function inspect(node, page) {
  // Canonical URLs are metadata, not navigation or assets. Astro's 404 page
  // uses /404/ as its canonical route but emits a host-served 404.html file.
  const canonical =
    node.tagName === "link" &&
    node.attrs.some(
      ({ name, value }) => name === "rel" && value === "canonical",
    );

  if (node.attrs) {
    for (const { name, value } of node.attrs) {
      if (name === "id") page.ids.add(value);

      if (
        !canonical &&
        (name === "href" || name === "src" || name === "poster")
      )
        page.links.push(value);
    }
  }

  for (const child of node.childNodes || []) inspect(child, page);
}

await collect(root);

for (const filename of files) {
  if (!filename.endsWith(".html")) continue;

  const route = filename.replace(/index\.html$/, "");

  const page = {
    url: new URL(base + route, origin),
    ids: new Set(),
    links: [],
  };

  inspect(parse(await readFile(path.join(root, filename), "utf8")), page);
  pages.set(filename, page);
}

if (!pages.size)
  throw new Error(`No HTML pages found in ${root}. Run the docs build first.`);

for (const [filename, page] of pages) {
  for (const link of page.links) {
    if (!link) continue;

    const target = new URL(link, page.url);

    if (target.origin !== origin) continue;

    const pathname = decodeURIComponent(target.pathname);

    if (!pathname.startsWith(base)) {
      failures.push(`${filename}: link escapes DOCS_BASE: ${link}`);
      continue;
    }

    let destination = pathname.slice(base.length);

    if (!destination || destination.endsWith("/")) destination += "index.html";
    else if (!files.has(destination) && files.has(`${destination}/index.html`))
      destination += "/index.html";

    if (!files.has(destination)) {
      failures.push(`${filename}: missing target: ${link}`);
      continue;
    }

    const fragment = decodeURIComponent(target.hash.slice(1)).split(
      ":~:text=",
    )[0];

    if (
      fragment &&
      pages.has(destination) &&
      !pages.get(destination).ids.has(fragment)
    ) {
      failures.push(`${filename}: missing anchor: ${link}`);
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Checked internal links, assets, and anchors in ${pages.size} HTML pages (base: ${base}).`,
  );
}
