import { filePath, type DiffFile, type FileChange } from "./wire";

export interface TreeNode {
  key: string;
  name: string;
  fileIndex?: number;
  children: TreeNode[];
}
export interface TreeRow {
  node: TreeNode;
  depth: number;
}
/** Paths identify directory nodes; streamed file indexes preserve diff navigation. */
export function buildFileTree(files: Pick<FileChange, "file">[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const directories = new Map<string, TreeNode>();
  files.forEach((file, fileIndex) => {
    const path = filePath(file.file);
    const parts = path.split("/").filter(Boolean);
    let children = roots, prefix = "";
    parts.forEach((name, i) => {
      prefix += "/" + name;
      if (i === parts.length - 1) {
        children.push({ key: `file:${fileIndex}`, name, fileIndex, children: [] });
      } else {
        let dir = directories.get(prefix);
        if (!dir) {
          dir = { key: prefix, name, children: [] };
          directories.set(prefix, dir);
          children.push(dir);
        }
        children = dir.children;
      }
    });
  });
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(a.fileIndex !== undefined) - Number(b.fileIndex !== undefined)
      || a.name.localeCompare(b.name));
    nodes.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}
export function flattenFileTree(nodes: TreeNode[], closed: Set<string>, depth = 0): TreeRow[] {
  return nodes.flatMap(node => [
    { node, depth },
    ...(node.fileIndex === undefined && !closed.has(node.key)
      ? flattenFileTree(node.children, closed, depth + 1) : []),
  ]);
}
export function parentDirectories(file: Pick<FileChange, "file">): string[] {
  const parts = filePath(file.file).split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
}
/** The wire's counts, verbatim: textual and visible, and why the AST match fell back if it did. */
export function lineCounts(file: DiffFile) {
  if (file.diff.type === "binary") return { textual: { added: 0, removed: 0 }, visible: { added: 0, removed: 0 } };
  return { textual: file.diff.stats.textual, visible: file.diff.stats.visible, fallback: file.diff.stats.fallback };
}
