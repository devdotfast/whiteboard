/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { illegalArgument } from "../../../../base/common/errors.js";
import type { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { URI, type UriComponents } from "../../../../base/common/uri.js";
import { getCodeEditor, type IActiveCodeEditor } from "../../../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../../../editor/browser/services/codeEditorService.js";
import { Range, type IRange } from "../../../../editor/common/core/range.js";
import type { ISelection } from "../../../../editor/common/core/selection.js";
import { ScrollType, type IDecorationOptions, type IDecorationRenderOptions } from "../../../../editor/common/editorCommon.js";
import { IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { EditorActivation, EditorResolution } from "../../../../platform/editor/common/editor.js";
import type { ExtensionIdentifier } from "../../../../platform/extensions/common/extensions.js";
import { type ITextDocumentShowOptions, type MainThreadTextEditorsShape, TextEditorRevealType } from "../../../../workbench/api/common/extHost.protocol.js";
import { columnToEditorGroup, type EditorGroupColumn } from "../../../../workbench/services/editor/common/editorGroupColumn.js";
import { IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const ICONS = new Set(["gutterIconPath", "contentIconPath"]);
/** A CSS value the window pastes into a rule: no second declaration, rule or escape, and nothing it would fetch. */
const UNSAFE_CSS = /[;{}\\]|url\s*\(|image/i;

/**
 * Upstream's editor peer works on the window's code editors and its one
 * decoration-type registry, and a decoration's hover is rendered trusted, so
 * its `command:` links would run window commands. For a remote host: only
 * editors on its own files, hovers made untrusted and stripped of links,
 * icons from its own files only, CSS that cannot fetch or break out of its
 * rule, and decoration types named for the host. Reviews are read-only, so
 * edits, snippets and editor options are refused.
 */
export class ReviewRemoteTextEditors implements MainThreadTextEditorsShape {
	private readonly types = new Set<string>();
	private readonly prefix: string;

	constructor(
		_context: IExtHostContext,
		@ICodeEditorService private readonly codeEditors: ICodeEditorService,
		@IEditorService private readonly editors: IEditorService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		// A CSS class name, distinct per host and from upstream's numeric prefixes.
		this.prefix = refusals.authority.replace(/[^\w-]/g, "-");
	}

	/** The editor the documents peer told this host about: one of the window's, on this host's own file. */
	private editor(id: string): IActiveCodeEditor {
		const editor = this.codeEditors.listCodeEditors().find((candidate): candidate is IActiveCodeEditor =>
			candidate.hasModel() && `${candidate.getId()},${candidate.getModel().id}` === id && this.refusals.owns(candidate.getModel().uri));
		if (!editor) throw illegalArgument(`TextEditor(${id})`);
		return editor;
	}

	private key(key: string): string {
		return `${this.prefix}-${key}`;
	}

	private markdown(value: IMarkdownString | IMarkdownString[] | undefined) {
		return Array.isArray(value) ? value.map((item) => this.refusals.markdown(item)) : value && this.refusals.markdown(value);
	}

	/** Render options rebuilt: icons only from this host's files, CSS values that stay in their declaration. */
	private style<T>(options: T): T {
		if (!options || typeof options !== "object") return options;
		const result: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(options)) {
			if (ICONS.has(name)) {
				if (value && this.refusals.owns(URI.revive(value as UriComponents))) result[name] = value;
				else this.refusals.refuse("decoration icons outside this remote");
			} else if (typeof value === "string" && name !== "contentText" && UNSAFE_CSS.test(value)) {
				this.refusals.refuse("decoration styles that fetch or add CSS");
			} else {
				result[name] = typeof value === "object" ? this.style(value) : value;
			}
		}
		return result as T;
	}

	async $tryShowTextDocument(resource: UriComponents, options: ITextDocumentShowOptions): Promise<string | undefined> {
		const pane = await this.editors.openEditor({
			resource: URI.revive(resource),
			options: {
				preserveFocus: options.preserveFocus,
				pinned: options.pinned,
				selection: options.selection,
				activation: options.preserveFocus ? EditorActivation.RESTORE : undefined,
				override: EditorResolution.EXCLUSIVE_ONLY,
			},
		}, columnToEditorGroup(this.groups, this.configuration, options.position));
		const editor = getCodeEditor(pane?.getControl());
		return editor?.hasModel() ? `${editor.getId()},${editor.getModel().id}` : undefined;
	}

	async $tryShowEditor(id: string, position?: EditorGroupColumn): Promise<void> {
		await this.editors.openEditor({ resource: this.editor(id).getModel().uri, options: { preserveFocus: false } }, columnToEditorGroup(this.groups, this.configuration, position));
	}

	async $tryHideEditor(): Promise<void> {
		throw this.refusals.refuse("changing the window's editors");
	}

	async $trySetSelections(id: string, selections: ISelection[]): Promise<void> {
		this.editor(id).setSelections(selections);
	}

	async $trySetDecorations(id: string, key: string, ranges: IDecorationOptions[]): Promise<void> {
		const decorations = ranges.map(({ range, hoverMessage, renderOptions }) => ({
			range,
			...(hoverMessage && { hoverMessage: this.markdown(hoverMessage) }),
			...(renderOptions && { renderOptions: this.style(renderOptions) }),
		}));
		this.editor(id).setDecorationsByType("exthost-api", this.key(key), decorations);
	}

	async $trySetDecorationsFast(id: string, key: string, ranges: number[]): Promise<void> {
		const editor = this.editor(id);
		const decorations: Range[] = [];
		for (let i = 0; i + 3 < ranges.length; i += 4) decorations.push(new Range(ranges[i], ranges[i + 1], ranges[i + 2], ranges[i + 3]));
		editor.setDecorationsByTypeFast(this.key(key), decorations);
	}

	async $tryRevealRange(id: string, range: IRange, revealType: TextEditorRevealType): Promise<void> {
		const editor = this.editor(id);
		switch (revealType) {
			case TextEditorRevealType.InCenter: return editor.revealRangeInCenter(range, ScrollType.Smooth);
			case TextEditorRevealType.InCenterIfOutsideViewport: return editor.revealRangeInCenterIfOutsideViewport(range, ScrollType.Smooth);
			case TextEditorRevealType.AtTop: return editor.revealRangeAtTop(range, ScrollType.Smooth);
			default: return editor.revealRange(range, ScrollType.Smooth);
		}
	}

	async $trySetOptions(): Promise<void> {
		throw this.refusals.refuse("changing the window's editor options");
	}

	async $tryApplyEdits(): Promise<boolean> {
		throw this.refusals.refuse("editing documents or files");
	}

	async $tryInsertSnippet(): Promise<boolean> {
		throw this.refusals.refuse("editing documents or files");
	}

	async $getDiffInformation(): Promise<never> {
		throw this.refusals.refuse("reading the window's diffs");
	}

	$registerTextEditorDecorationType(extensionId: ExtensionIdentifier, key: string, options: IDecorationRenderOptions): void {
		key = this.key(key);
		if (this.types.has(key)) return;
		this.types.add(key);
		this.codeEditors.registerDecorationType(`exthost-api-${extensionId}`, key, this.style(options));
	}

	$removeTextEditorDecorationType(key: string): void {
		key = this.key(key);
		if (this.types.delete(key)) this.codeEditors.removeDecorationType(key);
	}

	dispose(): void {
		for (const key of this.types) this.codeEditors.removeDecorationType(key);
		this.types.clear();
	}
}
