/*---------------------------------------------------------------------------------------------
 * Copyright (c) dev.fast. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { ReviewDiffLens, ReviewDiffProgressFile } from './reviewProtocol.js';
import { regionLines, type StructuralRegion, type StructuralTextDiff } from './reviewStructuralDiff.js';

type Sources = ReviewDiffLens['ranges'];
type Source = Sources[number];

/** All members of a fold state, including a bundled doc comment and both revisions. */
export function structuralViewedScopes(diff: StructuralTextDiff, path: string, previousPath = path): ReadonlyMap<number, Sources> {
	const result = new Map<number, Source[]>();
	const scopes = new Set<number>();
	for (const [side, source, file] of [['base', diff.lhs, previousPath], ['head', diff.rhs, path]] as const) {
		const visit = (region: StructuralRegion) => {
			if (region.kind !== 'fold') return;
			if (region.syntax) scopes.add(region.fold_state_id);
			const span = regionLines(region);
			const fromLine = (region.syntax?.start.line ?? span.start) + 1;
			const toLine = region.syntax ? region.syntax.end.line + 1 : span.end;
			if (toLine >= fromLine) {
				const ranges = result.get(region.fold_state_id) ?? [];
				ranges.push({ side, file, fromLine, toLine });
				result.set(region.fold_state_id, ranges);
			}
			region.children.forEach(visit);
		};
		// The file header owns the root's viewed control.
		if (source?.root.kind === 'fold') source.root.children.forEach(visit);
	}
	for (const [id, ranges] of result) {
		if (scopes.has(id)) result.set(id, mergeSources(ranges));
		else result.delete(id);
	}
	return result;
}

/** Viewed state depends on changed-line coverage, never on whether a fold is open. */
export function structuralViewedProgress(sources: Sources, file: ReviewDiffProgressFile | undefined) {
	const changes = intersectSources(file?.changedRanges ?? [], sources);
	const viewed = intersectSources(changes, file?.viewedRanges ?? []);
	const count = (ranges: Sources, side: Source['side']) => ranges.reduce((sum, r) => sum + (r.side === side ? r.toLine - r.fromLine + 1 : 0), 0);
	const total = { additions: count(changes, 'head'), deletions: count(changes, 'base') };
	const remaining = { additions: total.additions - count(viewed, 'head'), deletions: total.deletions - count(viewed, 'base') };
	const size = total.additions + total.deletions, unread = remaining.additions + remaining.deletions;
	const state = size > 0 && unread === 0 ? 'viewed' : unread < size ? 'partial' : 'unread';
	return { state, total, remaining } as const;
}

/** Lens marks can cover individual changes without covering any complete syntax scope. */
export function structuralViewedRanges(scopes: ReadonlyMap<number, Sources> | undefined, file: ReviewDiffProgressFile | undefined): Sources {
	const ranges = intersectSources(file?.changedRanges ?? [], file?.viewedRanges ?? []);
	for (const sources of scopes?.values() ?? []) {
		if (structuralViewedProgress(sources, file).state === 'viewed') ranges.push(...sources);
	}
	return mergeSources(ranges);
}

function intersectSources(a: Sources, b: Sources): Source[] {
	return mergeSources(a.flatMap(left => b.flatMap(right => {
		if (left.side !== right.side || left.file !== right.file) return [];
		const fromLine = Math.max(left.fromLine, right.fromLine), toLine = Math.min(left.toLine, right.toLine);
		return fromLine <= toLine ? [{ ...left, fromLine, toLine }] : [];
	})));
}

function mergeSources(ranges: Sources): Source[] {
	const result: Source[] = [];
	for (const range of [...ranges].sort((a, b) => a.side.localeCompare(b.side) || a.file.localeCompare(b.file) || a.fromLine - b.fromLine)) {
		const last = result[result.length - 1];
		if (last && last.side === range.side && last.file === range.file && range.fromLine <= last.toLine + 1) {
			result[result.length - 1] = { ...last, toLine: Math.max(last.toLine, range.toLine) };
		} else result.push(range);
	}
	return result;
}
