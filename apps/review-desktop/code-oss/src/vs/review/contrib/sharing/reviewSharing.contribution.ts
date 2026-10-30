import { Disposable } from "../../../base/common/lifecycle.js";
import { ipcRenderer } from "../../../base/parts/sandbox/electron-browser/globals.js";
import { URI } from "../../../base/common/uri.js";
import { localize2 } from "../../../nls.js";
import { Action2, registerAction2 } from "../../../platform/actions/common/actions.js";
import { IFileDialogService } from "../../../platform/dialogs/common/dialogs.js";
import type { ServicesAccessor } from "../../../platform/instantiation/common/instantiation.js";
import {
	INotificationService,
	Severity,
} from "../../../platform/notification/common/notification.js";
import { IProgressService, ProgressLocation } from "../../../platform/progress/common/progress.js";
import { IQuickInputService } from "../../../platform/quickinput/common/quickInput.js";
import { IURLService, type IURLHandler } from "../../../platform/url/common/url.js";
import {
	registerWorkbenchContribution2,
	WorkbenchPhase,
} from "../../../workbench/common/contributions.js";
import { ReviewApiClient } from "../../common/reviewProtocol.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";
import { IReviewDesktopConnectionService } from "../../services/reviewDesktopConnectionService.js";

type ShareSource = { url: string } | { path: string };

async function openShare(
	source: ShareSource,
	session: IReviewDesktopConnectionService,
	tabs: IReviewCanvasEditorTabsService,
	notifications: INotificationService,
	progress: IProgressService,
) {
	try {
		const client = new ReviewApiClient(await session.getConnection());
		const title = "path" in source ? "Opening whiteboard file" : "Opening shared review";
		await progress.withProgress({ location: ProgressLocation.Notification, title }, async (reporter) => {
			const started = await client.post<{ reviewId: string }>("/sharing/import", source);
			for (;;) {
				const status = await client.read<{ reviewId: string; stage: string; title?: string; error?: string }>(`/sharing/import/${started.reviewId}`);
				if (status.stage === "error") throw new Error(status.error ?? "Could not open the shared session.");
				if (status.stage === "ready") {
					await tabs.openApiReview(status.reviewId, status.title ?? "Shared review");
					return;
				}
				const message = status.stage === "fetching"
					? "Fetching pinned GitHub commits…"
					: status.stage === "validating"
						? "Preparing pinned source…"
						: status.stage === "reading"
							? "Reading the file…"
							: "Downloading review resources…";
				reporter.report({ message });
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		});
	} catch (error) {
		notifications.prompt(
			Severity.Error,
			error instanceof Error ? error.message : "Could not open the shared session.",
			[{ label: "Retry", run: () => openShare(source, session, tabs, notifications, progress) }],
		);
	}
}

class SharedReviewUrlHandler extends Disposable implements IURLHandler {
	constructor(
		@IURLService urls: IURLService,
		@IReviewDesktopConnectionService private readonly session: IReviewDesktopConnectionService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@INotificationService private readonly notifications: INotificationService,
		@IProgressService private readonly progress: IProgressService,
	) {
		super();
		this._register(urls.registerHandler(this));
		const onFile = (_event: unknown, ...args: unknown[]) => {
			const [path] = args;
			if (typeof path === "string") void openShare({ path }, this.session, this.tabs, this.notifications, this.progress);
		};
		ipcRenderer.on("vscode:openWhiteboardFile", onFile);
		this._register({ dispose: () => ipcRenderer.removeListener("vscode:openWhiteboardFile", onFile) });
	}
	async handleURL(uri: URI): Promise<boolean> {
		if (uri.authority !== "share") return false;
		try {
			const origin = new URLSearchParams(uri.query).get("origin") ?? "https://app.dev.fast";
			await openShare({ url: new URL(`/s${uri.path}`, origin).href }, this.session, this.tabs, this.notifications, this.progress);
		} catch {
			this.notifications.error("Invalid Whiteboard share link.");
		}
		return true;
	}
}
registerWorkbenchContribution2(
	"review.sharing.urls",
	SharedReviewUrlHandler,
	WorkbenchPhase.BlockRestore,
);
registerAction2(
	class extends Action2 {
		constructor() {
			super({
				id: "whiteboard.openSharedSession",
				title: localize2("whiteboard.openSharedSession", "Open Shared Session"),
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor) {
			const session = accessor.get(IReviewDesktopConnectionService),
				tabs = accessor.get(IReviewCanvasEditorTabsService),
				notifications = accessor.get(INotificationService),
				progress = accessor.get(IProgressService);
			const url = await accessor
				.get(IQuickInputService)
				.input({
					prompt: "Paste a Whiteboard share link",
					placeHolder: "https://app.dev.fast/s/…",
					ignoreFocusLost: true,
				});
			if (url) await openShare({ url }, session, tabs, notifications, progress);
		}
	},
);
registerAction2(
	class extends Action2 {
		constructor() {
			super({
				id: "whiteboard.openWhiteboardFile",
				title: localize2("whiteboard.openWhiteboardFile", "Open Whiteboard File…"),
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor) {
			const session = accessor.get(IReviewDesktopConnectionService),
				tabs = accessor.get(IReviewCanvasEditorTabsService),
				notifications = accessor.get(INotificationService),
				progress = accessor.get(IProgressService);
			const [file] = (await accessor.get(IFileDialogService).showOpenDialog({
				title: "Open Whiteboard File",
				openLabel: "Open",
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: [{ name: "Whiteboard", extensions: ["whiteboard"] }],
			})) ?? [];
			if (file) await openShare({ path: file.fsPath }, session, tabs, notifications, progress);
		}
	},
);
