export const summary =
  "// pseudocode\nCollect every matching entry, normalize its path and metadata, then render the complete result while preserving the original ordering and error details for the caller.\nReturn the processed entries.";

export const plugin = {
  name: "mobile-stress-summary",
  description: "Deterministic summary for UI tests",
  enabled: true,
  code: `(file)=>{for(const side of [file.lhs,file.rhs]){if(!side)continue;const visit=(r,depth)=>{if(r.kind!=='fold')return;if(depth===1)r.visibility={collapsed:true,label:${JSON.stringify(summary)}};else r.children.forEach(c=>visit(c,depth+1));};visit(side.root,0);}}`,
};

export function fixture() {
  const files = [],
    texts = { base: {}, head: {} };

  for (let f = 0; f < 24; f++) {
    const path = `src/group-${Math.floor(f / 6)}/file-${f}.ts`;

    const source = (version) =>
      Array.from(
        { length: 12 },
        (_, i) =>
          `export function process${i}(value: number) {\n${Array.from({ length: 10 }, (_, j) => `  const result${j} = value + ${j + version}; // ${"long code content ".repeat(12)}`).join("\n")}\n  return result9;\n}`,
      ).join("\n\n");

    files.push({
      path,
      status: "modified",
      additions: 120,
      deletions: 120,
      sha: `blob-${f}`,
    });
    texts.base[path] = source(0);
    texts.head[path] = source(1);
  }

  return {
    change: {
      target: { kind: "pull", owner: "fixture", repo: "mobile", number: 1 },
      title: "Mobile interaction stress fixture",
      url: "https://github.com/fixture/mobile/pull/1",
      base: "base",
      head: "head",
      files,
    },
    texts,
  };
}
