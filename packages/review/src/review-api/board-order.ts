/** What sibling order reads about a board. */
export interface SiblingFacts {
  id: string;
  /** When it was made: an edit never moves it. */
  createdAt: string;
  /** Its pins: commits of repositoryId. Plans have none. */
  repositoryId?: string;
  base?: string;
  head?: string;
  /** A PR board's head branch, and its PR's base branch, when known. */
  headBranch?: string;
  baseBranch?: string;
}

/**
 * Siblings in reading order. A comes after B when A reaches B through
 * depends_on, directly or through boards outside the siblings. Between two
 * siblings with no such chain either way, commits decide: A comes after B
 * when A's base is, or descends from, B's head, or A's PR merges into B's
 * branch. Remaining ties go newest made first, then by id, so an edit
 * never reorders them.
 */
export function orderSiblings(
  siblings: readonly SiblingFacts[],
  dependsOn: (id: string) => readonly string[],
  isAncestor: (repositoryId: string, ancestor: string, of: string) => boolean,
): string[] {
  const reach = new Map(
    siblings.map((board) => [board.id, reachable(board.id, dependsOn)]),
  );

  const after = (a: SiblingFacts, b: SiblingFacts) => {
    if (reach.get(a.id)!.has(b.id)) return true;

    if (reach.get(b.id)!.has(a.id)) return false;

    return buildsOn(a, b, isAncestor) && !buildsOn(b, a, isAncestor);
  };

  const before = new Map(
    siblings.map((a) => [
      a.id,
      new Set(siblings.flatMap((b) => (b !== a && after(a, b) ? [b.id] : []))),
    ]),
  );

  const newestFirst = [...siblings].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.id.localeCompare(b.id),
  );

  const placed = new Set<string>();
  const order: string[] = [];

  while (order.length < siblings.length) {
    const remaining = newestFirst.filter((board) => !placed.has(board.id));

    // Inferred order can disagree with itself; then age breaks the loop.
    const next =
      remaining.find((board) =>
        [...before.get(board.id)!].every((id) => placed.has(id)),
      ) ?? remaining[0]!;

    placed.add(next.id);
    order.push(next.id);
  }

  return order;
}

function reachable(
  id: string,
  dependsOn: (id: string) => readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const stack = [...dependsOn(id)];

  while (stack.length) {
    const next = stack.pop()!;

    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...dependsOn(next));
  }

  return seen;
}

/** Whether a's change sits on top of b's. */
function buildsOn(
  a: SiblingFacts,
  b: SiblingFacts,
  isAncestor: (repositoryId: string, ancestor: string, of: string) => boolean,
): boolean {
  if (a.repositoryId !== b.repositoryId) return false;

  if (a.baseBranch && a.baseBranch === b.headBranch) return true;

  if (!a.base || !b.head) return false;

  if (a.base === b.head) return true;

  // A board with no change of its own builds on nothing.
  return a.base !== a.head && isAncestor(a.repositoryId!, b.head, a.base);
}

/**
 * The path that adding `from → to` would close, from `from` back to itself,
 * or undefined when it closes none.
 */
export function dependencyCycle(
  from: string,
  to: string,
  dependsOn: (id: string) => readonly string[],
): string[] | undefined {
  if (from === to) return [from, from];

  const previous = new Map<string, string>();
  const queue = [to];
  const seen = new Set([to]);

  while (queue.length) {
    const current = queue.shift()!;

    if (current === from) {
      const path = [from];

      for (let at = from; at !== to; at = previous.get(at)!)
        path.unshift(previous.get(at)!);

      return [from, ...path];
    }

    for (const next of dependsOn(current))
      if (!seen.has(next)) {
        seen.add(next);
        previous.set(next, current);
        queue.push(next);
      }
  }

  return undefined;
}
