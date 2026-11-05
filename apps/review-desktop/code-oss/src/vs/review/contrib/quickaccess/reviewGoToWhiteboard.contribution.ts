/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from "../../../base/common/codicons.js";
import { toErrorMessage } from "../../../base/common/errorMessage.js";
import { compareItemsByFuzzyScore, type FuzzyScorerCache, prepareQuery, scoreItemFuzzy } from "../../../base/common/fuzzyScorer.js";
import { KeyCode, KeyMod } from "../../../base/common/keyCodes.js";
import { DisposableStore } from "../../../base/common/lifecycle.js";
import { posix } from "../../../base/common/path.js";
import { ThemeIcon } from "../../../base/common/themables.js";
import { EditorContextKeys } from "../../../editor/common/editorContextKeys.js";
import { localize, localize2 } from "../../../nls.js";
import { Action2, registerAction2 } from "../../../platform/actions/common/actions.js";
import { ICommandService } from "../../../platform/commands/common/commands.js";
import { ContextKeyExpr } from "../../../platform/contextkey/common/contextkey.js";
import type { ServicesAccessor } from "../../../platform/instantiation/common/instantiation.js";
import { IKeybindingService } from "../../../platform/keybinding/common/keybinding.js";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingsRegistry.js";
import { INotificationService } from "../../../platform/notification/common/notification.js";
import { IQuickInputService, type IQuickPickItem, type IQuickPickSeparator, quickPickItemScorerAccessor } from "../../../platform/quickinput/common/quickInput.js";
import { registerThemingParticipant } from "../../../platform/theme/common/themeService.js";
import { inQuickPickContext } from "../../../workbench/browser/quickaccess.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { boardOf } from "../../browser/parts/canvas/reviewCanvasEditorInput.js";
import { showReviewNotification } from "../../browser/reviewNotification.js";
import { REVIEW_OPEN_HOME_COMMAND_ID, REVIEW_OPEN_SETTINGS_COMMAND_ID } from "../../common/reviewCommandPalette.js";
import {
	jumpRows,
	parsePullRequestLink,
	pullRequestDestination,
	RECENT_BOARD_LIMIT,
	REVIEW_GO_TO_WHITEBOARD_COMMAND_ID,
	type JumpRow,
	type PullRequestDestination,
	type PullRequestLink,
} from "../../common/reviewGoToWhiteboard.js";
import { REVIEW_NEW_WHITEBOARD_COMMAND_ID } from "../../common/reviewNewWhiteboard.js";
import { BOARD_ICONS, boardIconMarkup, PULL_REQUEST_STATE_ICONS } from "../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";

/** A destination the bar can act on; "none" is a message, not a row. */
type ReachableDestination = Exclude<PullRequestDestination, { kind: "none" }>;

type JumpItem = IQuickPickItem & (
	| { readonly kind: "board"; readonly reviewId: string }
	| { readonly kind: "command"; readonly commandId: string }
	| { readonly kind: "pullRequest"; readonly destination: ReachableDestination; readonly link: PullRequestLink }
);

/** Names a row across re-renders of the list. */
function itemKey(item: JumpItem | undefined): string | undefined {
	if (item?.kind === "board") return item.reviewId;
	return item?.kind === "command" ? item.commandId : item?.link.url;
}

const COMMANDS: readonly { id: string; label: string; icon: ThemeIcon }[] = [
	{ id: REVIEW_NEW_WHITEBOARD_COMMAND_ID, label: localize("review.goToWhiteboard.new", "New Whiteboard"), icon: Codicon.add },
	{ id: REVIEW_OPEN_HOME_COMMAND_ID, label: localize("review.goToWhiteboard.home", "Go Home"), icon: Codicon.home },
	{ id: REVIEW_OPEN_SETTINGS_COMMAND_ID, label: localize("review.goToWhiteboard.settings", "Settings"), icon: Codicon.settingsGear },
	{ id: "workbench.action.selectTheme", label: localize("review.goToWhiteboard.theme", "Theme..."), icon: Codicon.symbolColor },
];

/** TerminalContextKeyStrings.Focus; importing it would pull the terminal's
 * modules into board windows, which have no terminal. */
const TERMINAL_FOCUS = "terminalFocus";

const ICON_CLASS = "review-go-icon";
const UNREAD_CLASS = "review-go-unread";

/**
 * Boards draw with the icons the canvas and the sidebar draw, as masks on the
 * quick pick's icon slot: the board or code board in muted ink, a PR in its
 * state's color. An unread board has the sidebar's dot on its corner, cut
 * out of the icon by a ring so it reads on any row background.
 */
registerThemingParticipant((_theme, collector) => {
	const muted = "var(--vscode-descriptionForeground)";
	const colors: Record<JumpRow["icon"], string> = {
		board: muted,
		code: muted,
		open: "var(--review-success)",
		draft: "var(--vscode-disabledForeground)",
		merged: "var(--review-merged)",
		closed: "var(--review-danger)",
	};
	const icons = { ...BOARD_ICONS, ...PULL_REQUEST_STATE_ICONS };
	const root = `.quick-input-widget .monaco-icon-label.${ICON_CLASS}`;
	collector.addRule(`${root}::before { content: ""; background-size: auto; background-position: 0 0; background-repeat: no-repeat; mask-repeat: no-repeat; mask-size: 14px 14px; mask-position: 1px center; }`);
	for (const [kind, color] of Object.entries(colors)) {
		const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(boardIconMarkup(icons[kind as JumpRow["icon"]]))}")`;
		collector.addRule(`${root}-${kind}::before { background-color: ${color}; mask-image: ${mask}; --review-go-mask: ${mask}; }`);
	}
	// The dot's center sits on the icon's top right corner, as StatusDot's
	// does: the icon is centered in the 16px slot codicons fill. Layers, top
	// first: the dot, added to the icon less the ring.
	const disc = (radius: number) => `radial-gradient(circle at 15px 4px, black ${radius}px, transparent ${radius + 0.5}px)`;
	collector.addRule(`${root}.${UNREAD_CLASS}::before { background-image: radial-gradient(circle at 15px 4px, var(--review-accent) 3px, transparent 3.5px); mask-image: ${disc(3)}, var(--review-go-mask), ${disc(4.5)}; mask-size: auto, 14px 14px, auto; mask-position: 0 0, 1px center, 0 0; mask-composite: add, subtract, add; }`);
});

function boardItem(row: JumpRow): JumpItem {
	return {
		kind: "board",
		reviewId: row.reviewId,
		label: row.label,
		description: row.description,
		ariaLabel: row.unread ? localize("review.goToWhiteboard.unread", "{0}, unread, {1}", row.label, row.description) : `${row.label}, ${row.description}`,
		iconClasses: [ICON_CLASS, `${ICON_CLASS}-${row.icon}`, ...(row.unread ? [UNREAD_CLASS] : [])],
	};
}

function pullRequestItem(link: PullRequestLink, destination: ReachableDestination): JumpItem {
	const row = { kind: "pullRequest", link, destination, description: link.slug, iconClasses: [ICON_CLASS, `${ICON_CLASS}-open`] } as const;
	switch (destination.kind) {
		case "open":
			return { ...row, label: localize("review.goToWhiteboard.openPr", "Open the board for PR #{0}", link.number) };
		case "restore":
			return { ...row, label: localize("review.goToWhiteboard.restorePr", "In Trash: restore the board for PR #{0}", link.number) };
		case "create":
			return {
				...row,
				label: localize("review.goToWhiteboard.createPr", "Create a whiteboard for PR #{0}", link.number),
				description: localize("review.goToWhiteboard.inCheckout", "{0} · in {1}", link.slug, posix.basename(destination.repositoryPath)),
			};
	}
}

/** The items the query matches, best first. */
function filtered<T extends IQuickPickItem>(items: readonly T[], value: string): T[] {
	const query = prepareQuery(value);
	const cache: FuzzyScorerCache = Object.create(null);
	return items
		.map((item) => ({ item, score: scoreItemFuzzy(item, query, true, quickPickItemScorerAccessor, cache) }))
		.filter(({ score }) => score.score > 0)
		.sort((a, b) => compareItemsByFuzzyScore(a.item, b.item, query, true, quickPickItemScorerAccessor, cache))
		.map(({ item, score }) => ({ ...item, highlights: { label: score.labelMatch, description: score.descriptionMatch } }));
}

/**
 * ⌘K: jump to any board in any repository or checkout by title, repository,
 * branch, PR or parent board, or run one of a few commands. A pasted PR link
 * opens the PR's board, or creates it in a checkout of the PR's repository.
 */
class ReviewGoToWhiteboardAction extends Action2 {
	constructor() {
		super({
			id: REVIEW_GO_TO_WHITEBOARD_COMMAND_ID,
			title: localize2("review.goToWhiteboard", "Go to Whiteboard..."),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				// In a code editor, ⌘K stays the first key of its chords. In a
				// terminal, should a window ever have one, it stays Terminal: Clear:
				// this clause decides that, not which of the two registers last.
				when: ContextKeyExpr.and(EditorContextKeys.editorTextFocus.toNegated(), ContextKeyExpr.not(TERMINAL_FOCUS), inQuickPickContext.negate()),
				// Above upstream's ⌘K chords, which it would otherwise wait on.
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const catalog = accessor.get(IReviewApiCatalogService);
		const tabs = accessor.get(IReviewCanvasEditorTabsService);
		const commands = accessor.get(ICommandService);
		const keybindings = accessor.get(IKeybindingService);
		const notifications = accessor.get(INotificationService);
		const current = boardOf(accessor.get(IEditorService).activeEditor);

		const disposables = new DisposableStore();
		const picker = disposables.add(accessor.get(IQuickInputService).createQuickPick<JumpItem>({ useSeparators: true }));
		picker.placeholder = localize("review.goToWhiteboard.placeholder", "Go to a whiteboard, PR or command; paste a PR link to open its board");
		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;

		const shortcut = (id: string) => {
			const keybinding = keybindings.lookupKeybinding(id);
			return keybinding?.hasMultipleChords() ? undefined : keybinding;
		};
		const commandItems: JumpItem[] = COMMANDS.map(({ id, label, icon }) => ({
			kind: "command",
			commandId: id,
			label,
			iconClass: ThemeIcon.asClassName(icon),
			// Outside code editors ⌘K opens this bar, so its chords are not shown.
			keybinding: shortcut(id),
		}));
		let boards: JumpItem[] = [];
		// A failed restore or create, until the query changes.
		let failure: string | undefined;
		const render = () => {
			const value = picker.value.trim();
			const link = parsePullRequestLink(value);
			const destination = link && pullRequestDestination(link, catalog.reviews);
			let notice: string | undefined;
			if (link && destination) {
				if (destination.kind === "none") notice = localize("review.goToWhiteboard.noCheckout", "No checkout of {0} here. Make a whiteboard in a checkout of it first.", link.slug);
				picker.items = destination.kind === "none" ? [] : [pullRequestItem(link, destination)];
			} else if (value) {
				// Boards and commands in one list, best match first.
				const matches = filtered([...boards, ...commandItems], value);
				if (!matches.length) notice = localize("review.goToWhiteboard.noMatch", "No whiteboard or command matches.");
				picker.items = matches;
			} else {
				const recent = boards.slice(0, RECENT_BOARD_LIMIT);
				const heading = recent.length < boards.length
					? localize("review.goToWhiteboard.recentOf", "recent, {0} of {1}", recent.length, boards.length)
					: localize("review.goToWhiteboard.recent", "recent");
				picker.items = [
					...(recent.length ? [{ type: "separator", label: heading } satisfies IQuickPickSeparator, ...recent] : []),
					{ type: "separator", label: localize("review.goToWhiteboard.commands", "commands") },
					...commandItems,
				];
			}
			picker.validationMessage = failure ?? notice;
		};
		/** Follows the live list: the query, the active row and the scroll stay. */
		const refresh = () => {
			const active = itemKey(picker.activeItems[0]);
			boards = jumpRows(catalog.reviews, current).map(boardItem);
			picker.keepScrollPosition = true;
			render();
			const same = picker.items.find((item): item is JumpItem => item.type !== "separator" && itemKey(item) === active);
			if (same) picker.activeItems = [same];
			picker.keepScrollPosition = false;
		};

		const open = async (reviewId: string, title: string) => {
			picker.hide();
			// Opening the board focuses it.
			await tabs.openApiReview(reviewId, title);
		};
		/**
		 * Restoring or creating waits on the server, the bar busy. The board
		 * exists whether or not the bar is still up: closed, it no longer takes
		 * the reader anywhere, so a notification offers the board instead.
		 */
		let working = false;
		const settle = async (work: () => Promise<{ reviewId: string; title: string }>) => {
			working = picker.busy = true;
			try {
				const { reviewId, title } = await work();
				if (!disposables.isDisposed) return await open(reviewId, title);
				showReviewNotification(notifications, {
					kind: "success",
					text: localize("review.goToWhiteboard.ready", "\"{0}\" is ready.", title),
					actions: [{ label: localize("review.goToWhiteboard.openReady", "Open"), run: () => void tabs.openApiReview(reviewId, title) }],
				});
			} catch (error) {
				if (disposables.isDisposed) {
					showReviewNotification(notifications, { kind: "error", text: toErrorMessage(error) });
					return;
				}
				failure = toErrorMessage(error);
				render();
			} finally {
				working = false;
				if (!disposables.isDisposed) picker.busy = false;
			}
		};

		disposables.add(picker.onDidChangeValue(() => {
			failure = undefined;
			render();
		}));
		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
			if (!item || working) return;
			if (item.kind === "board") return void open(item.reviewId, item.label);
			if (item.kind === "command") {
				picker.hide();
				return void commands.executeCommand(item.commandId);
			}
			const { destination, link } = item;
			if (destination.kind === "open") return void open(destination.reviewId, destination.title);
			if (destination.kind === "restore") {
				return void settle(async () => {
					await catalog.lifecycle(destination.reviewId, "active");
					return destination;
				});
			}
			void settle(async () => {
				const reviewId = await catalog.createPullRequestReview(destination.repositoryPath, link.url);
				const title = catalog.reviews.find((review) => review.reviewId === reviewId)?.title;
				return { reviewId, title: title || localize("review.goToWhiteboard.prTitle", "PR #{0}", link.number) };
			});
		}));
		disposables.add(catalog.onDidChange(refresh));
		disposables.add(picker.onDidHide(() => disposables.dispose()));

		refresh();
		picker.show();
		if (catalog.loaded) return;
		// The first list is still on its way: commands show, boards follow.
		picker.busy = true;
		try {
			await catalog.initialize();
		} catch (error) {
			failure = toErrorMessage(error);
			if (!disposables.isDisposed) render();
		}
		if (!disposables.isDisposed) picker.busy = false;
	}
}

registerAction2(ReviewGoToWhiteboardAction);
