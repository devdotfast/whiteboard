import type { CodeRef } from "./model";

/** The files a block's anchors point into, by path. In the lab this is a
 * fixture standing in for the repository at head. */
export type Repo = Record<string, string>;

export type CodeState = "checked" | "changed" | "unlinked";

export interface CodeCheck {
  name: string;
  ref: CodeRef | null;
  path: string;
  /** The linked lines, from 1 and inclusive. */
  start: number;
  end: number;
  state: "checked" | "changed";
  /** Why a changed claim no longer holds, or where its evidence went. */
  reason?: string;
  /** The file's lines, when it exists. */
  lines?: string[];
  /** Where the evidence is now, from 1, when the code moved. */
  movedTo?: number;
}

const ANCHOR = /^head\/(.+)#L(\d+)(?:-L(\d+))?$/;

/** Checks one named reference: its evidence must still be inside the
 * lines it points at. */
export function checkCode(
  name: string,
  ref: CodeRef | undefined,
  repo: Repo,
): CodeCheck {
  const broken = (reason: string): CodeCheck => ({
    name,
    ref: ref ?? null,
    path: "",
    start: 0,
    end: 0,
    state: "changed",
    reason,
  });

  if (!ref) return broken("The diagram names code the block does not define.");

  const match = String(ref.anchor ?? "").match(ANCHOR);

  if (!match)
    return broken(
      ref.anchor
        ? `“${ref.anchor}” is not a head anchor.`
        : "The reference has no anchor.",
    );

  const [, path, from, to] = match;
  const start = Number(from);
  const end = Number(to ?? from);

  if (start < 1 || end < start)
    return broken(`“${ref.anchor}” is not a line range.`);

  const evidence = String(ref.evidence ?? "").replaceAll("\r\n", "\n");

  // Empty evidence would match any lines at all.
  if (!evidence.trim())
    return broken("The reference has no evidence to check the lines against.");

  const base = { name, ref, path, start, end };
  const file = repo[path];

  if (file === undefined)
    return {
      ...base,
      state: "changed",
      reason: `${path} is not in the repository any more.`,
    };

  const text = file.replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  const range = lines.slice(start - 1, end).join("\n");

  if (range.includes(evidence)) return { ...base, state: "checked", lines };

  const movedTo = nearest(text, evidence, start);

  return {
    ...base,
    lines,
    state: "changed",
    movedTo,
    reason: movedTo
      ? `The code moved: its evidence is now at line ${movedTo}, outside the linked lines.`
      : "The evidence is no longer in this file: the call was renamed or removed.",
  };
}

/** The line, from 1, of the occurrence of `evidence` closest to `line`,
 * so an unrelated earlier mention does not win. */
function nearest(text: string, evidence: string, line: number) {
  let best: number | undefined;

  for (
    let index = text.indexOf(evidence);
    index >= 0;
    index = text.indexOf(evidence, index + 1)
  ) {
    const at = text.slice(0, index).split("\n").length;

    if (best === undefined || Math.abs(at - line) < Math.abs(best - line))
      best = at;
  }

  return best;
}

/** A claim holds only when all its code does. */
export function claimState(
  names: string[],
  checks: Map<string, CodeCheck>,
): CodeState {
  if (!names.length) return "unlinked";

  return names.every((name) => checks.get(name)?.state === "checked")
    ? "checked"
    : "changed";
}
