import { mainWindow } from "../../../base/browser/window.js";
import { CancellationTokenSource } from "../../../base/common/cancellation.js";
import { Disposable, toDisposable } from "../../../base/common/lifecycle.js";
import { IConfigurationService } from "../../../platform/configuration/common/configuration.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { FocusMode } from "../../../platform/native/common/native.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { IHostService } from "../../../workbench/services/host/browser/host.js";
import { REVIEW_READY_NOTIFICATION_SETTING } from "../../common/reviewConfigurationDefaults.js";
import { ReviewApiClient, type ReviewApiSummary, type ReviewReadyNotificationChoice } from "../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";
import { IReviewDesktopConnectionService } from "../../services/reviewDesktopConnectionService.js";
import { type FinishedReview, notifyReviewDone, ReviewCompletionTracker } from "./reviewDoneNotification.js";

class ReviewDoneNotification extends Disposable {
	private readonly tracker = new ReviewCompletionTracker();
	private readonly abort = new AbortController();
	private readonly cancellation = new CancellationTokenSource();

	constructor(
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IHostService private readonly host: IHostService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		this._register(toDisposable(() => { this.abort.abort(); this.cancellation.dispose(true); }));
		this.tracker.update(catalog.reviews);
		this._register(catalog.onDidChange(() => {
			for (const review of this.tracker.update(catalog.reviews)) {
				void this.notify(review).catch(error => this.log.warn("[Whiteboard] Completion notification failed:", error));
			}
		}));
		void catalog.initialize().catch(error => this.log.warn("[Whiteboard] Completion catalog unavailable:", error));
	}

	private async notify(review: ReviewApiSummary): Promise<void> {
		const choice = this.configuration.getValue<ReviewReadyNotificationChoice>(REVIEW_READY_NOTIFICATION_SETTING);
		if (choice === "off") return;
		const client = new ReviewApiClient(await this.connection.getConnection());
		const snapshot = await client.read<FinishedReview>(`/${encodeURIComponent(review.reviewId)}/inspect?full=true&format=json`, this.abort.signal);
		const current = this.catalog.reviews.find(item => item.reviewId === review.reviewId);
		if (this.abort.signal.aborted || !current || current.dismissedAt || current.working !== false) return;
		await notifyReviewDone(snapshot, {
			isViewing: () => this.host.hasFocus && this.tabs.isActiveReview(review.reviewId),
			// Notify badges the Dock icon until the window is focused.
			requestAttention: async () => { if (choice !== "notification") await this.host.focus(mainWindow, { mode: FocusMode.Notify }); },
			showToast: options => this.host.showToast(options, this.cancellation.token),
			openReview: async () => { await this.tabs.openApiReview(review.reviewId, snapshot.title); },
			focus: () => this.host.focus(mainWindow, { mode: FocusMode.Force }),
		});
	}
}

registerWorkbenchContribution2("review.doneNotification", ReviewDoneNotification, WorkbenchPhase.AfterRestored);
