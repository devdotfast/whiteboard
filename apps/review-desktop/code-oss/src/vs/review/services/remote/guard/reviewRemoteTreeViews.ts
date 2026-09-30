/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from "../../../../base/common/buffer.js";
import type { MainThreadTreeViewsShape } from "../../../../workbench/api/common/extHost.protocol.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { IReviewRemoteExtensions, IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/** The view ids a host's extensions contribute under `contributes.views`. */
export function remoteContributedViews(extensions: readonly { contributes?: { views?: unknown } }[]): Set<string> {
	const ids = new Set<string>();
	for (const extension of extensions) {
		const containers = extension.contributes?.views;
		if (!containers || typeof containers !== "object") continue;
		for (const views of Object.values(containers)) {
			if (Array.isArray(views)) for (const view of views) if (typeof view?.id === "string") ids.add(view.id);
		}
	}
	return ids;
}

/**
 * Upstream's tree view peer looks a view id up in the window-wide registry and
 * sets its data provider, so a remote naming a laptop extension's view would
 * fill it with items whose commands the window runs. The window registers no
 * view contribution of a remote's, so a host's own view ids have nothing to
 * show: they are accepted and do nothing. Every other id is refused.
 */
export class ReviewRemoteTreeViews implements MainThreadTreeViewsShape {
	private readonly own: Set<string>;

	constructor(
		_context: IExtHostContext,
		@IReviewRemoteExtensions extensions: IReviewRemoteExtensions,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		this.own = remoteContributedViews(extensions.extensions);
	}

	private check(treeViewId: string): void {
		if (!this.own.has(treeViewId)) throw this.refusals.refuse("using the window's views", treeViewId);
	}

	async $registerTreeViewDataProvider(treeViewId: string) { this.check(treeViewId); }
	async $refresh(treeViewId: string) { this.check(treeViewId); }
	async $reveal(treeViewId: string) { this.check(treeViewId); }
	$setMessage(treeViewId: string) { this.check(treeViewId); }
	$setTitle(treeViewId: string) { this.check(treeViewId); }
	$setBadge(treeViewId: string) { this.check(treeViewId); }
	async $disposeTree(treeViewId: string) { this.check(treeViewId); }
	async $resolveDropFileData(): Promise<VSBuffer> { throw this.refusals.refuse("using the window's views"); }
	$logResolveTreeNodeFailure(): void { }
	dispose(): void { }
}
