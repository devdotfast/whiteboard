import { VSBuffer } from "../../../base/common/buffer.js";
import { isMacintosh } from "../../../base/common/platform.js";
import { basename, joinPath } from "../../../base/common/resources.js";
import { IFileDialogService } from "../../../platform/dialogs/common/dialogs.js";
import { IFileService } from "../../../platform/files/common/files.js";
import type { ServicesAccessor } from "../../../platform/instantiation/common/instantiation.js";
import { INativeHostService } from "../../../platform/native/common/native.js";
import { INotificationService, Severity } from "../../../platform/notification/common/notification.js";
import { IPathService } from "../../../workbench/services/path/common/pathService.js";
import { ReviewApiClient } from "../../common/reviewProtocol.js";
import { IReviewDesktopConnectionService } from "../../services/reviewDesktopConnectionService.js";

export async function exportReviewFile(
	accessor: ServicesAccessor,
	args: { reviewId: string; version?: number },
): Promise<void> {
	const session = accessor.get(IReviewDesktopConnectionService);
	const dialogs = accessor.get(IFileDialogService);
	const files = accessor.get(IFileService);
	const nativeHost = accessor.get(INativeHostService);
	const notifications = accessor.get(INotificationService);
	const paths = accessor.get(IPathService);

	const client = new ReviewApiClient(await session.getConnection());
	const { filename, text } = await client.post<{ filename: string; text: string }>("/sharing/export", args);

	// The workspace folder is the hidden pinned checkout; start at home.
	const target = await dialogs.showSaveDialog({
		title: "Export Whiteboard",
		saveLabel: "Export",
		defaultUri: joinPath(await paths.userHome(), filename),
		filters: [{ name: "Whiteboard", extensions: ["whiteboard"] }],
	});
	if (!target) return;

	await files.writeFile(target, VSBuffer.fromString(text));
	notifications.prompt(Severity.Info, `Exported ${basename(target)}.`, [
		{ label: isMacintosh ? "Show in Finder" : "Show in Folder", run: () => nativeHost.showItemInFolder(target.fsPath) },
	]);
}
