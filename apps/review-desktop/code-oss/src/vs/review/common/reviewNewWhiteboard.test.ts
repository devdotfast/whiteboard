import assert from "node:assert/strict";
import test from "node:test";
import { newWhiteboardRepositoryPath } from "./reviewNewWhiteboard.js";

const board = (reviewId: string, project: string | undefined, repositoryPath: string | undefined, viewedAt: string | null) => ({
	reviewId,
	createdAt: "2026-01-01T00:00:00Z",
	viewedAt,
	trashedAt: null,
	...(project && { project: { id: project, name: project } }),
	...(repositoryPath && { repositoryPath }),
});

const reviews = [
	board("api", "api", "/src/api", "2026-03-01T00:00:00Z"),
	board("web", "web", "/src/web", "2026-02-01T00:00:00Z"),
	board("web-shared", "web", undefined, "2026-04-01T00:00:00Z"),
	board("loose", undefined, undefined, "2026-05-01T00:00:00Z"),
];

test("a new whiteboard goes in the active board's project", () => {
	assert.equal(newWhiteboardRepositoryPath(reviews, ["web", "api"]), "/src/web");
});

test("from Home, the board viewed last picks the project", () => {
	assert.equal(newWhiteboardRepositoryPath(reviews, []), "/src/web");
});

test("a board with no checkout here borrows one from its project", () => {
	assert.equal(newWhiteboardRepositoryPath(reviews, ["web-shared"]), "/src/web");
});

test("with no project there is nowhere to put it", () => {
	assert.equal(newWhiteboardRepositoryPath([reviews[3]!], ["loose"]), undefined);
});
