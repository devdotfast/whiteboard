/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from "../../../../base/browser/dom.js";
import { Disposable } from "../../../../base/common/lifecycle.js";
import { IInstantiationService, createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import { IStorageService } from "../../../../platform/storage/common/storage.js";
import { IThemeService } from "../../../../platform/theme/common/themeService.js";
import { Part } from "../../../../workbench/browser/part.js";
import { IWorkbenchLayoutService, Parts } from "../../../../workbench/services/layout/browser/layoutService.js";

import "../../media/review.css";

/** Full-height column right of the board; one host per canvas pane. */
class ReviewAskPart extends Part {
	override readonly minimumWidth = 320;
	override readonly maximumWidth = 900;
	override readonly minimumHeight = 0;
	override readonly maximumHeight = Number.POSITIVE_INFINITY;

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super(Parts.REVIEW_ASK_PART, { hasTitle: false, borderWidth: () => 0 }, themeService, storageService, layoutService);
	}

	/** Hosts requested before create(), e.g. while editors restore. */
	private readonly pending: HTMLElement[] = [];

	override create(parent: HTMLElement): void {
		this.element = parent;
		super.create(parent);
		parent.append(...this.pending.splice(0));
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		return parent;
	}

	/** A host for one canvas pane's Ask. */
	addHost(): HTMLElement {
		// The canvas stylesheet is scoped to .review-canvas-root.
		const host = $(".review-ask-host.review-canvas-root");
		host.hidden = true;
		if (this.element) this.element.appendChild(host);
		else this.pending.push(host);
		return host;
	}

	toJSON(): object {
		return { type: Parts.REVIEW_ASK_PART };
	}
}

export const IReviewAskPartsService = createDecorator<IReviewAskPartsService>("reviewAskPartsService");

export interface IReviewAskPartsService {
	readonly _serviceBrand: undefined;

	/** The element a canvas pane's docked Ask renders into. */
	host(owner: object): HTMLElement;

	/** Whether the pane's canvas has Ask docked open. */
	setDocked(owner: object, docked: boolean): void;

	/** Whether the pane is on screen; a hidden pane's Ask is not shown. */
	setShown(owner: object, shown: boolean): void;

	/** Removes the pane's host once the pane is disposed. */
	release(owner: object): void;
}

interface AskOwner {
	readonly host: HTMLElement;
	docked: boolean;
	shown: boolean;
}

/** Creates the Ask column and shows it while the pane on screen docks Ask. */
export class ReviewAskParts extends Disposable implements IReviewAskPartsService {
	declare readonly _serviceBrand: undefined;

	private readonly part: ReviewAskPart;
	private readonly owners = new Map<object, AskOwner>();

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super();
		this.part = this._register(instantiationService.createInstance(ReviewAskPart));
	}

	host(owner: object): HTMLElement {
		return this.owner(owner).host;
	}

	setDocked(owner: object, docked: boolean): void {
		this.owner(owner).docked = docked;
		this.update();
	}

	setShown(owner: object, shown: boolean): void {
		this.owner(owner).shown = shown;
		this.update();
	}

	release(owner: object): void {
		this.owners.get(owner)?.host.remove();
		this.owners.delete(owner);
		this.update();
	}

	private owner(key: object): AskOwner {
		let owner = this.owners.get(key);
		if (!owner) {
			owner = { host: this.part.addHost(), docked: false, shown: false };
			this.owners.set(key, owner);
		}
		return owner;
	}

	private update(): void {
		let visible = false;
		for (const owner of this.owners.values()) {
			const open = owner.shown && owner.docked;
			owner.host.hidden = !open;
			visible ||= open;
		}
		this.layoutService.setPartHidden(!visible, Parts.REVIEW_ASK_PART);
	}
}
