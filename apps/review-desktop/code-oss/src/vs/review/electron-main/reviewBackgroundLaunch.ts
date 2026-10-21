/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FocusMode } from "../../platform/native/common/native.js";

/** "1" on `whiteboard app` launches without --focus; "always" never takes focus; "hidden" also hides windows (e2e runs). */
export const REVIEW_DESKTOP_BACKGROUND_ENV = "DEV_FAST_REVIEW_DESKTOP_BACKGROUND";

export const isBackgroundLaunch = (env: NodeJS.ProcessEnv) =>
	["1", "always", "hidden"].includes(env[REVIEW_DESKTOP_BACKGROUND_ENV] ?? "");

interface BackgroundWindow {
	show(): void;
	showInactive(): void;
	setOpacity(opacity: number): void;
	setIgnoreMouseEvents(ignore: boolean): void;
	once(event: "focus", listener: () => void): unknown;
}

/**
 * Shows the first window inactive and swallows focus until the user focuses a
 * window or a forced focus arrives. Releases once per process, unless "always".
 */
export class ReviewBackgroundLaunch {
	private pending: boolean;
	private readonly always: boolean;
	private readonly hidden: boolean;
	private showInactiveOnCreate = false;

	constructor(env: NodeJS.ProcessEnv = process.env) {
		this.hidden = env[REVIEW_DESKTOP_BACKGROUND_ENV] === "hidden";
		this.always = this.hidden || env[REVIEW_DESKTOP_BACKGROUND_ENV] === "always";
		this.pending = isBackgroundLaunch(env);
	}

	get suppressesFocus(): boolean {
		return this.pending;
	}

	/** Defers the initial show to `attach`, which shows the window inactive. */
	prepare(options: { show?: boolean }): void {
		if (!this.pending || options.show === false) return;
		options.show = false;
		this.showInactiveOnCreate = true;
	}

	attach(win: BackgroundWindow): void {
		if (!this.pending) return;
		if (this.hidden) {
			win.setOpacity(0);
			win.setIgnoreMouseEvents(true);
		}
		if (this.showInactiveOnCreate) win.showInactive();
		win.once("focus", () => this.release());
	}

	/** show() activates the app on macOS. */
	show(win: BackgroundWindow | null | undefined): void {
		if (this.pending) win?.showInactive();
		else win?.show();
	}

	allowsFocus(mode: FocusMode): boolean {
		if (!this.pending) return true;
		if (this.always) return false;
		if (mode === FocusMode.Force) {
			this.release();
			return true;
		}
		return mode === FocusMode.Notify;
	}

	private release(): void {
		if (this.always) return;
		this.pending = false;
		this.showInactiveOnCreate = false;
	}
}

export const reviewBackgroundLaunch = new ReviewBackgroundLaunch();
