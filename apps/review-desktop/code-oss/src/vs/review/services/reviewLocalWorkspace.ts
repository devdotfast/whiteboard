import { Queue } from "../../base/common/async.js";
import type { IDisposable } from "../../base/common/lifecycle.js";
import { Schemas } from "../../base/common/network.js";
import { URI } from "../../base/common/uri.js";
import type { IWorkspaceEditingService } from "../../workbench/services/workspaces/common/workspaceEditing.js";
import type { ReviewLanguageEnvironment, ReviewRemoteLanguageEnvironment } from "../common/reviewProtocol.js";
import { reviewRemoteAuthority } from "./remote/reviewRemoteAuthority.js";

type ReviewLanguageRoots = Pick<IWorkspaceEditingService, "addFolders" | "removeFolders">;

const sessions = new WeakMap<ReviewLanguageRoots, { queue: Queue<void>; roots: Map<string, number>; kept: URI | undefined }>();

/** Keep the last root until its replacement arrives: rust-analyzer stops when the workspace empties. */
export async function acquireReviewLanguageRoot(workspace: ReviewLanguageRoots, root: URI): Promise<IDisposable> {
	let session = sessions.get(workspace);
	if (!session) {
		session = { queue: new Queue<void>(), roots: new Map(), kept: undefined };
		sessions.set(workspace, session);
	}
	const state = session;
	const key = root.toString();
	await state.queue.queue(async () => {
		if (!state.roots.has(key)) {
			const kept = state.kept;
			state.kept = undefined;
			if (kept?.toString() !== key) {
				await workspace.addFolders([{ uri: root }]);
				if (kept) await workspace.removeFolders([kept]);
			}
		}
		state.roots.set(key, (state.roots.get(key) ?? 0) + 1);
	});
	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			void state.queue.queue(async () => {
				const count = (state.roots.get(key) ?? 1) - 1;
				if (count > 0) { state.roots.set(key, count); return; }
				state.roots.delete(key);
				if (state.roots.size === 0) state.kept = root;
				else await workspace.removeFolders([root]);
			});
		}
	};
}

export function reviewLanguageRoot(context: ReviewLanguageEnvironment | ReviewRemoteLanguageEnvironment | undefined): { root: URI; serverId?: string } | undefined {
	if (!context) return undefined;
	if (!("remoteRootPath" in context)) return context.rootPath ? { root: URI.file(context.rootPath) } : undefined;
	const authority = reviewRemoteAuthority(context.serverId);
	if (!context.remoteRootPath || !authority) return undefined;
	return { root: URI.from({ scheme: Schemas.vscodeRemote, authority, path: context.remoteRootPath }), serverId: context.serverId };
}
