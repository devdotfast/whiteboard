import { InlineLineNumbers, ReviewLineNumbersSetting } from "./reviewLineNumbers.js";
import { Action } from "../../base/common/actions.js";
import type { IDimension } from "../../base/browser/dom.js";
import { Codicon } from "../../base/common/codicons.js";
import { Color } from "../../base/common/color.js";
import { KeyCode } from "../../base/common/keyCodes.js";
import { Disposable, DisposableStore, MutableDisposable, toDisposable, type IDisposable } from "../../base/common/lifecycle.js";
import { basename } from "../../base/common/resources.js";
import { ThemeIcon } from "../../base/common/themables.js";
import type { URI } from "../../base/common/uri.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../editor/browser/services/codeEditorService.js";
import { EmbeddedCodeEditorWidget } from "../../editor/browser/widget/codeEditor/embeddedCodeEditorWidget.js";
import { DiffEditorWidget } from "../../editor/browser/widget/diffEditor/diffEditorWidget.js";
import { Range, type IRange } from "../../editor/common/core/range.js";
import { ScrollType } from "../../editor/common/editorCommon.js";
import { ITextModelService } from "../../editor/common/services/resolverService.js";
import { IPeekViewService, PeekViewWidget, peekViewBorder, peekViewTitleBackground, peekViewTitleForeground, peekViewTitleInfoForeground } from "../../editor/contrib/peekView/browser/peekView.js";
import { IConfigurationService } from "../../platform/configuration/common/configuration.js";
import { ContextKeyExpr, RawContextKey } from "../../platform/contextkey/common/contextkey.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { KeybindingsRegistry, KeybindingWeight } from "../../platform/keybinding/common/keybindingsRegistry.js";
import { IThemeService, type IColorTheme } from "../../platform/theme/common/themeService.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../workbench/common/contributions.js";
import { IEditorService } from "../../workbench/services/editor/common/editorService.js";
import { REVIEW_PEEK_SIDE_BY_SIDE_SETTING } from "../common/reviewConfigurationDefaults.js";
import { REVIEW_API_SOURCE_SCHEME, sourceLocation } from "../common/reviewSourceView.js";
import { IReviewTelemetryService } from "./reviewTelemetryService.js";

const ReviewDefinitionPeekVisible = new RawContextKey<boolean>("reviewDefinitionPeekVisible", false);

const hosts = new Map<HTMLElement, ReviewDefinitionPeekDiffs>();
const peeks = new WeakMap<ICodeEditor, ReviewDefinitionPeekWidget>();

/** The Diff view's model pair for a changed file; its diff provider only knows these. */
export type ReviewDefinitionPeekDiffs = (resource: URI) => { original: URI; modified: URI } | undefined;

export function markReviewDefinitionPeekHost(container: HTMLElement, diffs: ReviewDefinitionPeekDiffs): IDisposable {
	hosts.set(container, diffs);
	return toDisposable(() => hosts.delete(container));
}

function hostDiffs(editor: ICodeEditor): ReviewDefinitionPeekDiffs | undefined {
	// A native peek's preview keeps its own navigation.
	if (editor instanceof EmbeddedCodeEditorWidget) return undefined;
	const node = editor.getContainerDomNode();
	for (const [container, diffs] of hosts) if (container.contains(node)) return diffs;
	return undefined;
}

class ReviewDefinitionPeekWidget extends PeekViewWidget {
	private readonly input = new MutableDisposable<DisposableStore>();
	private target: { resource: URI; range: IRange } | undefined;
	private view: { layout(dimension: IDimension): void } | undefined;
	editors: readonly ICodeEditor[] = [];

	constructor(
		editor: ICodeEditor,
		private readonly diffs: ReviewDefinitionPeekDiffs,
		@IThemeService themeService: IThemeService,
		@IPeekViewService peekViewService: IPeekViewService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITextModelService private readonly textModels: ITextModelService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(editor, { showFrame: true, showArrow: true, isResizeable: true, isAccessible: true, supportOnTitleClick: true }, instantiationService);
		this.applyTheme(themeService.getColorTheme());
		this._disposables.add(themeService.onDidColorThemeChange(theme => this.applyTheme(theme)));
		this._disposables.add(this.input);
		// Close the previous peek before its reset can clear this key.
		peekViewService.addExclusiveWidget(editor, this);
		const visible = ReviewDefinitionPeekVisible.bindTo(editor.contextKeyService);
		visible.set(true);
		this._disposables.add(toDisposable(() => visible.reset()));
		this.create();
	}

	private applyTheme(theme: IColorTheme): void {
		const border = theme.getColor(peekViewBorder) ?? Color.transparent;
		this.style({
			arrowColor: border,
			frameColor: border,
			headerBackgroundColor: theme.getColor(peekViewTitleBackground) ?? Color.transparent,
			primaryHeadingColor: theme.getColor(peekViewTitleForeground),
			secondaryHeadingColor: theme.getColor(peekViewTitleInfoForeground),
		});
	}

	protected override _fillHead(container: HTMLElement): void {
		super._fillHead(container);
		this._actionbarWidget!.push(new Action("review.definitionPeek.openSource", "Open in Source window", ThemeIcon.asClassName(Codicon.goToFile), true, () => this.openSource()), { label: false, icon: true, index: 0 });
	}

	protected override _onTitleClick(): void {
		this.openSource();
	}

	protected _fillBody(): void { }

	protected override _doLayoutBody(height: number, width: number): void {
		super._doLayoutBody(height, width);
		this.view?.layout({ height, width });
	}

	async setInput(resource: URI, range: IRange): Promise<ICodeEditor> {
		const { file, side } = sourceLocation(resource);
		const pair = this.diffs(resource);
		const store = new DisposableStore();
		const resolve = async (uri: URI) => store.add(await this.textModels.createModelReference(uri)).object.textEditorModel;
		try {
			const models = pair ? { original: await resolve(pair.original), modified: await resolve(pair.modified) } : await resolve(resource);
			this._bodyElement!.replaceChildren();
			// An embedded editor inherits the Diff view's wheel-less scrollbar.
			const options = { readOnly: true, scrollBeyondLastLine: false, minimap: { enabled: false }, stickyScroll: { enabled: false }, fixedOverflowWidgets: true, scrollbar: { vertical: "auto", horizontal: "auto", handleMouseWheel: true, alwaysConsumeMouseWheel: true } } as const;
			let editor: ICodeEditor;
			if ("original" in models) {
				const diff = store.add(this.instantiationService.createInstance(DiffEditorWidget, this._bodyElement!, {
					...options,
					renderOverviewRuler: false,
					// Unified hides the base pane, so a base target keeps both panes.
					renderSideBySide: side === "base" || this.configuration.getValue<boolean>(REVIEW_PEEK_SIDE_BY_SIDE_SETTING) === true,
				}, {}));
				diff.setModel(models);
				this.view = diff;
				this.editors = [diff.getOriginalEditor(), diff.getModifiedEditor()];
				editor = side === "base" ? diff.getOriginalEditor() : diff.getModifiedEditor();
			} else {
				editor = store.add(this.instantiationService.createInstance(EmbeddedCodeEditorWidget, this._bodyElement!, options, {}, this.editor));
				editor.setModel(models);
				this.view = editor;
				this.editors = [editor];
			}
			this.view.layout({ height: this._bodyElement!.clientHeight, width: this._bodyElement!.clientWidth });
			const lineNumbers = store.add(this.instantiationService.createInstance(ReviewLineNumbersSetting));
			for (const inner of this.editors) {
                peeks.set(inner, this);
                store.add(new InlineLineNumbers(inner, lineNumbers));
            }
			this.input.value = store;
			this.target = { resource, range };
			this.setTitle(basename(resource), [file.slice(0, Math.max(0, file.lastIndexOf("/"))), pair ? "changed" : undefined].filter(Boolean).join(" · "));
			editor.setSelection(Range.collapseToStart(range));
			editor.revealRangeInCenter(range, ScrollType.Immediate);
			editor.createDecorationsCollection([{ range, options: { description: "review-definition-peek", className: "reference-decoration" } }]);
			editor.focus();
			return editor;
		} catch (error) {
			store.dispose();
			throw error;
		}
	}

	private openSource(): void {
		if (!this.target) return;
		void this.editorService.openEditor({ resource: this.target.resource, options: { selection: Range.collapseToStart(this.target.range), pinned: true } });
	}
}

export class ReviewDefinitionPeek extends Disposable {
	static readonly ID = "review.definitionPeek";

	constructor(
		@ICodeEditorService codeEditors: ICodeEditorService,
		@IReviewTelemetryService telemetry: IReviewTelemetryService,
	) {
		super();
		this._register(codeEditors.registerCodeEditorOpenHandler(async (input, source, sideBySide) => {
			const range = (input.options as { selection?: IRange } | undefined)?.selection;
			if (!source || sideBySide || !range || input.resource.scheme !== REVIEW_API_SOURCE_SCHEME) return null;
			const peek = peeks.get(source);
			if (peek?.editors.includes(source)) return peek.setInput(input.resource, range);
			const diffs = hostDiffs(source);
			if (!diffs) return null;
			telemetry.capture("peek_opened", { via: "diff_definition" });
			return open(source, diffs, input.resource, range);
		}));
	}
}

async function open(editor: ICodeEditor, diffs: ReviewDefinitionPeekDiffs, resource: URI, range: IRange): Promise<ICodeEditor> {
	// The editor's scope has the editor progress and diff provider a diff editor needs.
	const widget = editor.invokeWithinContext(accessor => accessor.get(IInstantiationService).createInstance(ReviewDefinitionPeekWidget, editor, diffs));
	peeks.set(editor, widget);
	widget.onDidClose(() => {
		if (peeks.get(editor) === widget) peeks.delete(editor);
		editor.focus();
	});
	widget.show(editor.getPosition()!, 18);
	try {
		return await widget.setInput(resource, range);
	} catch (error) {
		widget.dispose();
		throw error;
	}
}

registerWorkbenchContribution2(ReviewDefinitionPeek.ID, ReviewDefinitionPeek, WorkbenchPhase.AfterRestored);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: "review.closeDefinitionPeek",
	weight: KeybindingWeight.EditorContrib + 50,
	primary: KeyCode.Escape,
	when: ContextKeyExpr.and(ReviewDefinitionPeekVisible, ContextKeyExpr.not("config.editor.stablePeek")),
	handler: accessor => {
		const editor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
		if (editor) peeks.get(editor)?.dispose();
	},
});
