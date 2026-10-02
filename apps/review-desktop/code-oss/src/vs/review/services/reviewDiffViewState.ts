/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ISelection } from "../../editor/common/core/selection.js";
import { type JsonValue, jsonArray, jsonBoolean, jsonNumber, jsonObject, jsonString, parseJsonText } from "../common/reviewProtocol.js";
import { URI } from "../../base/common/uri.js";
import type { IMultiDiffEditorViewState } from "../../editor/browser/widget/multiDiffEditor/multiDiffEditorWidgetImpl.js";
import { type IStorageService, StorageScope, StorageTarget } from "../../platform/storage/common/storage.js";

interface SavedState { key: string; state: IMultiDiffEditorViewState }

function parseSelection(value: JsonValue): ISelection | undefined {
	const item = jsonObject(value);
	if (!item) return undefined;
	const selectionStartLineNumber = jsonNumber(item.selectionStartLineNumber);
	const selectionStartColumn = jsonNumber(item.selectionStartColumn);
	const positionLineNumber = jsonNumber(item.positionLineNumber);
	const positionColumn = jsonNumber(item.positionColumn);
	if (selectionStartLineNumber === undefined || selectionStartColumn === undefined || positionLineNumber === undefined || positionColumn === undefined) return undefined;
	if (![selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn].every(n => Number.isInteger(n) && n > 0)) return undefined;
	return { selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn };
}

function parseViewState(value: JsonValue | undefined): IMultiDiffEditorViewState | undefined {
	const item = jsonObject(value);
	const scroll = item && jsonObject(item.scrollState);
	const top = scroll && jsonNumber(scroll.top);
	const left = scroll && jsonNumber(scroll.left);
	if (!item || top === undefined || left === undefined || top < 0 || left < 0) return undefined;
	const docStates: IMultiDiffEditorViewState["docStates"] = {};
	for (const [key, value] of Object.entries(jsonObject(item.docStates) ?? {})) {
		const doc = jsonObject(value);
		const collapsed = doc && jsonBoolean(doc.collapsed);
		if (!doc || collapsed === undefined) continue;
		docStates[key] = { collapsed, selections: jsonArray(doc.selections)?.flatMap(value => {
			const selection = parseSelection(value);
			return selection ? [selection] : [];
		}) };
	}
	return { scrollState: { top, left }, docStates, activeDiffItemKey: jsonString(item.activeDiffItemKey) };
}

const STORAGE_KEY = "review.diffViewStates.v1";
const MAX_ENTRIES = 50;

function stableResource(uri: URI): URI {
	if (uri.scheme === "review-structural-empty") {
		return uri.with({ query: stableResource(URI.parse(uri.query)).toString() });
	}
	if (uri.scheme !== "review-api-source") return uri;
	const query = new URLSearchParams(uri.query);
	query.delete("generation");
	return uri.with({ query: query.toString() });
}

/** Model generations change on refresh; the comparison and file identities do not. */
function stableDiffItemKey(key: string): string | undefined {
	try {
		const resources = jsonArray(parseJsonText(key));
		if (resources?.length !== 2 || resources.some(resource => resource !== null && jsonString(resource) === undefined)) return undefined;
		return JSON.stringify(resources.map(resource => {
			if (!resource) return null;
			return stableResource(URI.parse(jsonString(resource)!)).toString();
		}));
	} catch { return undefined; }
}

export class ReviewDiffViewStateStorage {
	constructor(private readonly storage: Pick<IStorageService, "get" | "store">) { }

	private read(): SavedState[] {
		try {
			const raw = this.storage.get(STORAGE_KEY, StorageScope.APPLICATION);
			const saved = raw ? jsonObject(parseJsonText(raw)) : undefined;
			if (!saved || saved.version !== 1) return [];
			return (jsonArray(saved.entries) ?? []).slice(-MAX_ENTRIES).flatMap(value => {
				const entry = jsonObject(value);
				const key = entry && jsonString(entry.key);
				const state = entry && parseViewState(entry.state);
				return key && state ? [{ key, state }] : [];
			});
		} catch { return []; }
	}

	get(key: string, currentKeys: readonly string[]): IMultiDiffEditorViewState | undefined {
		const saved = this.read().find(entry => entry.key === key)?.state;
		if (!saved) return undefined;
		const keys = new Map(currentKeys.map(key => [stableDiffItemKey(key), key]));
		return {
			scrollState: saved.scrollState,
			activeDiffItemKey: saved.activeDiffItemKey ? keys.get(saved.activeDiffItemKey) : undefined,
			docStates: Object.fromEntries(Object.entries(saved.docStates ?? {}).flatMap(([key, state]) => {
				const current = keys.get(key);
				return current ? [[current, state]] : [];
			})),
		};
	}

	set(key: string, state: IMultiDiffEditorViewState): void {
		const normalized: IMultiDiffEditorViewState = {
			scrollState: state.scrollState,
			activeDiffItemKey: state.activeDiffItemKey ? stableDiffItemKey(state.activeDiffItemKey) : undefined,
			docStates: Object.fromEntries(Object.entries(state.docStates ?? {}).flatMap(([key, state]) => {
				const stable = stableDiffItemKey(key);
				return stable ? [[stable, state]] : [];
			})),
		};
		const entries = this.read().filter(entry => entry.key !== key);
		entries.push({ key, state: normalized });
		try {
			this.storage.store(STORAGE_KEY, JSON.stringify({ version: 1, entries: entries.slice(-MAX_ENTRIES) }), StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch { /* View state is best effort; the live editor remains usable. */ }
	}
}
