import assert from "node:assert/strict";
import test from "node:test";
import { type JumpBoard, jumpRows, parsePullRequestLink, pullRequestDestination } from "./reviewGoToWhiteboard.js";

const whiteboard = { id: "wb", name: "devdotfast/whiteboard" };
const cloud = { id: "cloud", name: "devdotfast/cloud" };

const board = (reviewId: string, fields: Partial<JumpBoard> = {}): JumpBoard => ({
	reviewId,
	title: reviewId,
	createdAt: "2026-01-01T00:00:00Z",
	viewedAt: null,
	trashedAt: null,
	project: whiteboard,
	repositoryName: "review",
	repositoryPath: "/src/review",
	...fields,
});

test("before anything is typed, unread boards lead, then the ones viewed last, without the board on screen", () => {
	const rows = jumpRows([
		board("old", { viewedAt: "2026-02-01T00:00:00Z" }),
		board("recent", { viewedAt: "2026-03-01T00:00:00Z" }),
		board("unread", { viewedAt: "2026-01-15T00:00:00Z", changed: true }),
		board("trashed", { viewedAt: "2026-04-01T00:00:00Z", trashedAt: "2026-04-02T00:00:00Z" }),
		board("current", { viewedAt: "2026-05-01T00:00:00Z" }),
	], "current");

	assert.deepEqual(rows.map((row) => [row.reviewId, row.unread]), [["unread", true], ["recent", false], ["old", false]]);
});

test("a row is found by its repository, PR, branch and parent plan", () => {
	const rows = jumpRows([
		board("plan", { title: "Plan: draw queue" }),
		board("pr", {
			title: "Share boards",
			parentId: "plan",
			target: { kind: "commits", repositoryId: "r", head: "h" },
			origin: { branch: "ketan/share", pullRequestNumber: 1480, pullRequestTitle: "Share boards that live on a remote host" },
			pullRequestState: "merged",
		}),
		board("ingest", { title: "", project: cloud, repositoryName: "cloud", repositoryPath: "/src/cloud" }),
	]);
	const byId = new Map(rows.map((row) => [row.reviewId, row]));
	const pr = byId.get("pr")!;

	for (const term of ["whiteboard", "#1480", "remote host", "ketan/share", "Plan: draw queue"]) assert.ok(pr.description.includes(term), term);
	assert.equal(pr.icon, "merged");
	assert.equal(byId.get("plan")!.icon, "board");
	assert.equal(byId.get("ingest")!.label, "Untitled");
	assert.ok(byId.get("ingest")!.description.includes("cloud"));
});

test("the checkout is named only when the project has boards in more than one", () => {
	const named = (boards: JumpBoard[]) => jumpRows(boards).some((row) => row.description.includes("review-cmdk"));

	assert.equal(named([board("main"), board("workspace", { repositoryName: "review-cmdk", repositoryPath: "/src/review-cmdk" })]), true);
	assert.equal(named([board("workspace", { repositoryName: "review-cmdk", repositoryPath: "/src/review-cmdk" })]), false);
});

test("a pasted PR link is read without its tab, query or trailing text", () => {
	assert.deepEqual(parsePullRequestLink(" https://github.com/devdotfast/whiteboard/pull/1477/files?w=1 "), {
		slug: "devdotfast/whiteboard",
		number: 1477,
		url: "https://github.com/devdotfast/whiteboard/pull/1477",
	});
	assert.equal(parsePullRequestLink("github.com/devdotfast/whiteboard/pull/12")?.number, 12);
	assert.equal(parsePullRequestLink("https://github.com/devdotfast/whiteboard/issues/12"), undefined);
	assert.equal(parsePullRequestLink("draw queue"), undefined);
	assert.equal(parsePullRequestLink("https://GHE.acme.dev/team/tool/pull/7#discussion")?.url, "https://ghe.acme.dev/team/tool/pull/7");
});

test("a PR link opens the PR's board, else creates one in the checkout of its repository used last", () => {
	const boards = [
		board("pr", { origin: { pullRequestUrl: "https://github.com/DevDotFast/Whiteboard/pull/1480" } }),
		board("older", { viewedAt: "2026-01-02T00:00:00Z" }),
		board("newer", { viewedAt: "2026-03-01T00:00:00Z", repositoryName: "review-cmdk", repositoryPath: "/src/review-cmdk" }),
		board("fork", { project: { id: "fork", name: "ketan0/scratch" }, repositoryPath: "/src/scratch", origin: { pullRequestUrl: "https://github.com/acme/tool/pull/3" } }),
	];

	assert.deepEqual(pullRequestDestination(parsePullRequestLink("https://github.com/devdotfast/whiteboard/pull/1480")!, boards), { kind: "open", reviewId: "pr", title: "pr" });
	assert.deepEqual(pullRequestDestination(parsePullRequestLink("https://github.com/devdotfast/whiteboard/pull/1477")!, boards), { kind: "create", repositoryPath: "/src/review-cmdk" });
	// A checkout whose project has another name still counts once it holds one of the repository's PRs.
	assert.deepEqual(pullRequestDestination(parsePullRequestLink("https://github.com/acme/tool/pull/9")!, boards), { kind: "create", repositoryPath: "/src/scratch" });
	assert.deepEqual(pullRequestDestination(parsePullRequestLink("https://github.com/other/repo/pull/1")!, boards), { kind: "none" });
});

test("an untitled PR board keeps the title every surface shows", () => {
	const untitled = board("pr", { title: "", origin: { pullRequestUrl: "https://github.com/devdotfast/whiteboard/pull/5" } });

	assert.deepEqual(pullRequestDestination(parsePullRequestLink(untitled.origin!.pullRequestUrl!)!, [untitled]), { kind: "open", reviewId: "pr", title: "Untitled" });
});

test("a PR whose board is in Trash restores it, unless a live board has the PR too", () => {
	const url = "https://github.com/devdotfast/whiteboard/pull/5";
	const link = parsePullRequestLink(url)!;
	const trashed = board("trashed", { trashedAt: "2026-04-02T00:00:00Z", origin: { pullRequestUrl: url } });

	assert.equal(pullRequestDestination(link, [trashed]).kind, "restore");
	assert.deepEqual(pullRequestDestination(link, [trashed, board("live", { origin: { pullRequestUrl: url } })]), { kind: "open", reviewId: "live", title: "live" });
});
