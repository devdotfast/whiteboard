import type { IReviewApiCatalogService } from "../services/reviewApiCatalogService.js";

/** Home and the sidebar create the same child, including cleanup if opening fails. */
export async function openChildWhiteboard(catalog: Pick<IReviewApiCatalogService, "reviews" | "createReview" | "discardReview">, tabs: { openApiReview(id: string, title: string): Promise<unknown> }, parentId: string): Promise<void> {
	const parent = catalog.reviews.find((board) => board.reviewId === parentId);
	if (!parent?.repositoryPath || parent.parentId || parent.trashedAt || parent.host) throw new Error("The parent whiteboard is no longer available on this machine.");
	const id = await catalog.createReview(parent.repositoryPath, parentId);
	try {
		await tabs.openApiReview(id, "Untitled");
	} catch (error) {
		await catalog.discardReview(id);
		throw error;
	}
}
