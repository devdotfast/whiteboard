/*---------------------------------------------------------------------------------------------
 * Copyright (c) dev.fast. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { ICodeEditor } from '../../editor/browser/editorBrowser.js';
import type { ScopeViewedControl } from './reviewStructuralViewedControl.js';
import type { FoldTarget } from './reviewStructuralFolds.js';
import { Emitter, type Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import type { ReviewDiffProgress, ReviewDiffViewSpec } from '../common/reviewProtocol.js';
import { structuralViewedProgress, structuralViewedRanges, structuralViewedScopes } from '../common/reviewStructuralViewed.js';
import type { ReviewFilesEditorEntry } from './reviewFilesDiffView.js';
import type { StructuralDiffSession } from './reviewStructuralDiffSession.js';

// Several peeks can mount on one comparison. Only its first coverage snapshot
// restores viewed folds; mounting another peek must not close a reopened fold.
const initializedScopes = new WeakMap<StructuralDiffSession, Set<string>>();

/** Viewed marks persist as line coverage; opening a fold only changes session fold state. */
export class StructuralViewedState extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly scopes = new Map<string, ReturnType<typeof structuralViewedScopes>>();
	private readonly states = new Map<string, string>();
	private pending = false;
	private requestedFold: { path: string; id: number; viewed: boolean } | undefined;

	constructor(
		private readonly session: StructuralDiffSession,
		private readonly entries: readonly ReviewFilesEditorEntry[],
		private readonly progress: () => ReviewDiffProgress | undefined,
		onProgress: Event<void>,
		private readonly onSetViewed: NonNullable<ReviewDiffViewSpec['onSetViewed']>,
		readonly createControl: (editor: ICodeEditor, onToggle: (target: FoldTarget) => void) => ScopeViewedControl,
	) {
		super();
		this._register(onProgress(() => this.sync()));
		this._register(session.onDidChange(() => this.sync()));
		this.sync();
	}

	private getScopes(path: string) {
		let scopes = this.scopes.get(path);
		const diff = this.session.getTextDiff(path);
		if (!scopes && diff) {
			scopes = structuralViewedScopes(diff, path, this.entries.find(e => e.file.path === path)?.file.previousPath);
			this.scopes.set(path, scopes);
		}
		return scopes;
	}

	get(path: string, id: number) {
		return structuralViewedProgress(this.getScopes(path)?.get(id) ?? [], this.progress()?.files.find(f => f.path === path));
	}

	getViewedRanges(path: string) {
		return structuralViewedRanges(this.getScopes(path), this.progress()?.files.find(f => f.path === path));
	}

	async toggle(path: string, id: number): Promise<void> {
		const ranges = this.getScopes(path)?.get(id);
		if (!ranges || this.pending) return;
		const viewed = this.get(path, id).state !== 'viewed';
		this.pending = true;
		this.requestedFold = { path, id, viewed };
		try {
			await this.onSetViewed(ranges, viewed);
			// Fold only the box the reader checked, not every newly covered
			// descendant. Reopening should recover the body's previous folds.
			this.applyRequestedFold();
		}
		catch (error) { this.requestedFold = undefined; throw error; }
		finally { this.pending = false; }
	}

	private sync(): void {
		const initialized = initializedScopes.get(this.session) ?? new Set<string>();
		initializedScopes.set(this.session, initialized);
		for (const entry of this.entries) {
			const path = entry.file.path;
			if (!this.progress()?.files.some(f => f.path === path)) continue;
			const scopes = this.getScopes(path);
			const viewed = [...scopes ?? []].filter(([id]) => this.get(path, id).state === 'viewed');
			for (const [id, ranges] of scopes ?? []) {
				const state = this.get(path, id).state;
				const key = `${path}:${id}`, previous = this.states.get(key);
				this.states.set(key, state);
				// Only transitions (and initial load) fold a viewed scope. Reopening
				// it must survive unrelated progress updates and layout changes.
				const enclosed = viewed.some(([other, outer]) => other !== id
					&& ranges.every(r => outer.some(o => r.side === o.side && r.file === o.file && o.fromLine <= r.fromLine && o.toLine >= r.toLine))
					&& !outer.every(o => ranges.some(r => r.side === o.side && r.file === o.file && r.fromLine <= o.fromLine && r.toLine >= o.toLine)));
				if (state === 'viewed' && !initialized.has(key) && !enclosed) this.session.setRegionCollapsed(path, id, true);
				else if (previous === 'viewed' && state !== 'viewed') this.session.setRegionCollapsed(path, id, false);
				initialized.add(key);
			}
		}
		this.applyRequestedFold();
		this.changed.fire();
	}

	private applyRequestedFold(): void {
		const request = this.requestedFold;
		// React may deliver the new coverage after the mutation promise resolves.
		// Wait for that coverage, rather than folding optimistically on a failed save.
		if (request && (this.get(request.path, request.id).state === 'viewed') === request.viewed) {
			this.requestedFold = undefined;
			this.session.setRegionCollapsed(request.path, request.id, request.viewed);
		}
	}
}
