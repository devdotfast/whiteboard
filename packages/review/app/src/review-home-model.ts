import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { fuzzyMatches } from "@review/fuzzy-match";

export type HomeSort = "updated" | "created" | "title" | "trash";

export type HomeGroup = "unread" | "week" | "earlier";

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

export function reviewTitle(review: ReviewApiSummary): string {
  return review.title.trim() || "Untitled whiteboard";
}

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

export function repositoryIdentity(
  review: ReviewApiSummary,
): { key: string; label: string } | undefined {
  if (review.repositoryGroup) return review.repositoryGroup;
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

/** Only hide a location when the filter pins that worktree, not its entire repo. */
export function reviewMetadataPills(
  review: ReviewApiSummary,
  filters: HomeFilters,
) {
  const branch = review.origin?.branch;
  const tree = worktreeLabel(review);

  return [
    ...(branch &&
    !(filters.branches.length === 1 && filters.branches[0] === branch)
      ? [{ facet: "branches" as const, key: branch, label: branch }]
      : []),
    ...(tree &&
    !(
      filters.worktrees.length === 1 &&
      !filters.repositories.length &&
      filters.worktrees[0] === worktreeKey(review)
    )
      ? [{ facet: "worktrees" as const, key: worktreeKey(review), label: tree }]
      : []),
  ];
}

export function isUnread(review: ReviewApiSummary): boolean {
  return (
    review.viewedAt === null ||
    Date.parse(review.createdAt) > Date.parse(review.viewedAt)
  );
}

export function groupFor(review: ReviewApiSummary, now: number): HomeGroup {
  if (isUnread(review)) return "unread";

  return Date.parse(review.createdAt) >= now - 7 * 86400000
    ? "week"
    : "earlier";
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
          reviewTitle(review),
          worktreeLabel(review),
          review.origin?.branch ?? "",
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
          query.trim() && fuzzyMatches(query.trim(), reviewTitle(review)),
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
      return reviewTitle(a).localeCompare(reviewTitle(b)) || updated;

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
