import { type ReviewApiSummary, boardTitle } from "@dev.fast/review-protocol";
import { fuzzyMatches } from "@review/fuzzy-match";

import { type WhiteboardBranch, whiteboardTree } from "./whiteboard-tree";

export type HomeSort = "updated" | "created" | "title" | "trash";

export type HomeGroup = "unread" | "week" | "earlier";

export type HomeFacet = "repositories" | "worktrees" | "branches";

export const homeFacetLabels: Record<HomeFacet, string> = {
  repositories: "Project",
  worktrees: "Worktree",
  branches: "Branch",
};

export function isHomeFacet(id: string): id is HomeFacet {
  return id in homeFacetLabels;
}

const day = 86_400_000;

export const trashRetentionDays = 30;

export interface HomeFilters {
  unread: boolean;
  repositories: string[];
  worktrees: string[];
  searches: string[];
  branches: string[];
}

export const defaultHomeFilters: HomeFilters = {
  unread: false,
  repositories: [],
  worktrees: [],
  searches: [],
  branches: [],
};

export const homeGroups: { id: HomeGroup; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "week", label: "Last 7 days" },
  { id: "earlier", label: "Older than 7 days" },
];

export function worktreeLabel(review: ReviewApiSummary): string {
  return review.repositoryPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

/** Worktree keys include the repository so equally named checkouts stay distinct. */
export function worktreeKey(review: ReviewApiSummary): string {
  return JSON.stringify([
    repositoryIdentity(review)?.key ?? "",
    review.repositoryPath ?? "",
  ]);
}

export function activeHomeChips(filters: HomeFilters): string[] {
  return [
    ...(filters.unread ? ["unread"] : []),
    ...(filters.repositories.length ? ["repositories"] : []),
    ...(filters.worktrees.length ? ["worktrees"] : []),
    ...(filters.branches.length ? ["branches"] : []),
    ...filters.searches.map((term) => `search:${term}`),
  ];
}

/** Keep chips where they were; new ones join the end. */
export function mergeChipOrder(
  order: readonly string[],
  filters: HomeFilters,
): string[] {
  const active = activeHomeChips(filters);

  return [
    ...new Set([
      ...order.filter((id) => active.includes(id)),
      ...active.filter((id) => !order.includes(id)),
    ]),
  ];
}

export function removeHomeChip(filters: HomeFilters, id: string): HomeFilters {
  if (id.startsWith("search:"))
    return {
      ...filters,
      searches: filters.searches.filter((term) => `search:${term}` !== id),
    };

  return { ...filters, [id]: isHomeFacet(id) ? [] : false };
}

export function homeFacetValues(
  filters: HomeFilters,
  facet: HomeFacet,
  reviews: readonly ReviewApiSummary[],
): string[] {
  if (facet === "branches") return filters.branches;

  const labels = new Map(
    facet === "repositories"
      ? homeRepositories(reviews).map((repo) => [repo.key, repo.label])
      : homeRepositories(reviews).flatMap((repo) =>
          repo.trees.map((tree) => [tree.key, tree.label] as const),
        ),
  );

  return filters[facet].map((key) => labels.get(key) ?? key);
}

export function trashDaysLeft(review: ReviewApiSummary, now: number): number {
  const left = Date.parse(review.trashedAt!) + trashRetentionDays * day - now;

  return Math.min(trashRetentionDays, Math.max(0, Math.ceil(left / day)));
}

export function repositoryIdentity(
  review: ReviewApiSummary,
): { key: string; label: string } | undefined {
  // A board's project names its repository, across its checkouts. One on
  // another machine is that machine's: the gateway keys it with the host.
  if (review.project)
    return {
      key: review.project.id,
      label: review.host
        ? `${review.host}: ${review.project.name}`
        : review.project.name,
    };

  const remote = review.shared?.cloneUrl || review.origin?.pullRequestUrl;

  if (!remote) return undefined;

  const url = URL.parse(remote.replace(/^git@([^:]+):/, "https://$1/"));

  if (!url) return undefined;

  const path = url.pathname
    .replace(/\/pull\/\d+.*$/, "")
    .replace(/\.git\/?$/, "")
    .replace(/^\/|\/$/g, "");

  if (!url.hostname || !path) return undefined;

  return {
    key: `remote:https://${url.hostname.toLowerCase()}/${path.toLowerCase()}.git`,
    label: path,
  };
}

export function repositoryLabel(review: ReviewApiSummary): string {
  return repositoryIdentity(review)?.label || review.repositoryName || "";
}

/** Only hide a location when the filter pins that worktree, not its entire repo.
 * A review's PR stands in for its worktree. */
export function reviewMetadataPills(
  review: ReviewApiSummary,
  filters: HomeFilters,
) {
  const branch = review.origin?.branch;
  const tree = worktreeLabel(review);

  const { pullRequestNumber, pullRequestUrl, pullRequestTitle } =
    review.origin ?? {};

  return [
    ...(branch &&
    !(filters.branches.length === 1 && filters.branches[0] === branch)
      ? [{ facet: "branches" as const, key: branch, label: branch }]
      : []),
    ...(pullRequestNumber && pullRequestUrl
      ? [
          {
            facet: "pullRequest" as const,
            key: pullRequestUrl,
            label: `#${pullRequestNumber}`,
            title: pullRequestTitle,
          },
        ]
      : tree &&
          !(
            filters.worktrees.length === 1 &&
            !filters.repositories.length &&
            filters.worktrees[0] === worktreeKey(review)
          )
        ? [
            {
              facet: "worktrees" as const,
              key: worktreeKey(review),
              label: tree,
            },
          ]
        : []),
  ];
}

export function isUnread(review: ReviewApiSummary): boolean {
  return (
    review.viewedAt === null ||
    Date.parse(review.createdAt) > Date.parse(review.viewedAt)
  );
}

/** Adds the children of `boards` that are in `pool`. */
export function withChildBoards(
  boards: readonly ReviewApiSummary[],
  pool: readonly ReviewApiSummary[],
): ReviewApiSummary[] {
  const byId = new Map(pool.map((board) => [board.reviewId, board]));
  const seen = new Set(boards.map((board) => board.reviewId));

  const children = boards
    .flatMap((board) => board.children ?? [])
    .flatMap((id) => {
      const child = byId.get(id);

      if (!child || seen.has(id)) return [];
      seen.add(id);

      return [child];
    });

  return [...boards, ...children];
}

export function groupFor(review: ReviewApiSummary, now: number): HomeGroup {
  if (isUnread(review)) return "unread";

  return Date.parse(review.createdAt) >= now - 7 * day ? "week" : "earlier";
}

export function matchesHomeFilters(
  review: ReviewApiSummary,
  filters: HomeFilters,
  query = "",
  omit?: keyof HomeFilters,
): boolean {
  return (
    (omit === "unread" || !filters.unread || isUnread(review)) &&
    ((!filters.repositories.length && !filters.worktrees.length) ||
      (omit !== "repositories" &&
        filters.repositories.includes(repositoryIdentity(review)?.key ?? "")) ||
      (omit !== "worktrees" &&
        filters.worktrees.includes(worktreeKey(review))) ||
      (omit === "repositories" && !filters.worktrees.length) ||
      (omit === "worktrees" && !filters.repositories.length)) &&
    (omit === "branches" ||
      !filters.branches.length ||
      filters.branches.includes(review.origin?.branch ?? "")) &&
    [...filters.searches, query]
      .filter((term) => term.trim())
      .every((term) =>
        fuzzyMatches(
          term.trim(),
          boardTitle(review.title),
          worktreeLabel(review),
          review.origin?.branch ?? "",
          review.origin?.pullRequestTitle ?? "",
          repositoryLabel(review),
        ),
      )
  );
}

export function sortHomeReviews(
  reviews: readonly ReviewApiSummary[],
  sort: HomeSort,
  queries: readonly string[] = [],
): ReviewApiSummary[] {
  const titleMatches = new Map(
    reviews.map((review) => [
      review.reviewId,
      queries.filter(
        (query) =>
          query.trim() && fuzzyMatches(query.trim(), boardTitle(review.title)),
      ).length,
    ]),
  );

  return [...reviews].sort((a, b) => {
    const relevance =
      titleMatches.get(b.reviewId)! - titleMatches.get(a.reviewId)!;

    if (relevance) return relevance;

    const updated =
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);

    if (sort === "trash")
      return Date.parse(b.trashedAt!) - Date.parse(a.trashedAt!);

    if (sort === "title")
      return boardTitle(a.title).localeCompare(boardTitle(b.title)) || updated;

    if (sort === "created")
      return (
        (Date.parse(b.firstCreatedAt ?? b.createdAt) || 0) -
          (Date.parse(a.firstCreatedAt ?? a.createdAt) || 0) || updated
      );

    return updated;
  });
}

export interface HomeRepository {
  key: string;
  label: string;
  trees: { key: string; label: string }[];
}

export function homeRepositories(
  reviews: readonly ReviewApiSummary[],
): HomeRepository[] {
  const groups = new Map<string, HomeRepository>();

  for (const review of reviews) {
    const repo = repositoryIdentity(review);
    const key = repo?.key ?? "";

    const group = groups.get(key) ?? {
      key,
      label: repo?.label ?? "Unknown repository",
      trees: [],
    };

    if (
      worktreeLabel(review) &&
      !group.trees.some((tree) => tree.key === worktreeKey(review))
    )
      group.trees.push({
        key: worktreeKey(review),
        label: worktreeLabel(review),
      });
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : a.label.localeCompare(b.label),
    )
    .map((repo) => ({
      ...repo,
      trees: repo.trees.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/** Normalize a user selection against the full catalog, not the narrowed options. */
export function normalizeHomeLocations(
  filters: HomeFilters,
  catalog: readonly HomeRepository[],
): HomeFilters {
  const repositories = new Set(filters.repositories);
  const worktrees = new Set(filters.worktrees);

  for (const repo of catalog) {
    const allTrees =
      repo.trees.length > 0 &&
      repo.trees.every((tree) => worktrees.has(tree.key));

    if (repo.key && allTrees) repositories.add(repo.key);

    if (repositories.has(repo.key) || allTrees)
      for (const tree of repo.trees) worktrees.delete(tree.key);
  }

  const resolved = catalog.filter((repo) => repo.key);

  if (
    resolved.length > 0 &&
    resolved.every((repo) => repositories.has(repo.key))
  )
    repositories.clear();

  return {
    ...filters,
    repositories: [...repositories],
    worktrees: [...worktrees],
  };
}

export function toggleHomeRepository(
  filters: HomeFilters,
  repo: HomeRepository,
  catalog: readonly HomeRepository[],
): HomeFilters {
  if (!repo.key) {
    // Selecting every unresolved worktree is the entire Worktree section: no restriction.
    return { ...filters, worktrees: [] };
  }

  return normalizeHomeLocations(
    {
      ...filters,
      repositories: filters.repositories.includes(repo.key)
        ? filters.repositories.filter((key) => key !== repo.key)
        : [...filters.repositories, repo.key],
      worktrees: filters.worktrees.filter(
        (key) => !repo.trees.some((tree) => tree.key === key),
      ),
    },
    catalog,
  );
}

export function toggleHomeWorktree(
  filters: HomeFilters,
  treeKey: string,
  catalog: readonly HomeRepository[],
): HomeFilters {
  const repo = catalog.find((repo) =>
    repo.trees.some((tree) => tree.key === treeKey),
  );

  if (repo && filters.repositories.includes(repo.key)) {
    // Narrow an explicit whole-repository selection by removing one child.
    return normalizeHomeLocations(
      {
        ...filters,
        repositories: filters.repositories.filter((key) => key !== repo.key),
        worktrees: [
          ...filters.worktrees,
          ...repo.trees
            .filter((tree) => tree.key !== treeKey)
            .map((tree) => tree.key),
        ],
      },
      catalog,
    );
  }

  return normalizeHomeLocations(
    {
      ...filters,
      worktrees: filters.worktrees.includes(treeKey)
        ? filters.worktrees.filter((key) => key !== treeKey)
        : [...filters.worktrees, treeKey],
    },
    catalog,
  );
}

/** Filter families without losing a matching child's parent or sibling order. */
export function homeBoardTree(
  boards: readonly ReviewApiSummary[],
  filters: HomeFilters,
  query: string,
  sort: HomeSort,
): WhiteboardBranch[] {
  const queries = [...filters.searches, query].filter(Boolean);

  const families = whiteboardTree(boards).flatMap((branch) => {
    const children = branch.children.filter((child) =>
      matchesHomeFilters(child, filters, query),
    );

    return matchesHomeFilters(branch.board, filters, query) || children.length
      ? [{ board: branch.board, children }]
      : [];
  });

  const representative = (branch: WhiteboardBranch) =>
    sort === "title" || sort === "created"
      ? branch.board
      : sortHomeReviews([branch.board, ...branch.children], sort, queries)[0];

  const ranks = new Map(
    sortHomeReviews(families.map(representative), sort, queries).map(
      (board, index) => [board.reviewId, index],
    ),
  );

  return families.sort(
    (left, right) =>
      ranks.get(representative(left).reviewId)! -
      ranks.get(representative(right).reviewId)!,
  );
}

/** A family lives in one date group, using its latest member and unread state. */
export function homeBranchGroup(
  branch: WhiteboardBranch,
  now: number,
): HomeGroup {
  const members = [branch.board, ...branch.children];

  if (members.some(isUnread)) return "unread";

  return members.some((member) => groupFor(member, now) === "week")
    ? "week"
    : "earlier";
}
