/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow } from 'electron';
import type { IHiddenPageRender, IHiddenPageResult } from '../common/native.js';

/** A page left idle this long gives its window back. */
const IDLE_MS = 15_000;

/** The tallest a page is captured, in CSS pixels: a capture at double density stays under the GPU's texture size. */
const MAX_HEIGHT = 8_000;

const START_HEIGHT = 900;

interface HiddenPage {
	readonly window: BrowserWindow;
	readonly ready: Promise<void>;
	/** The last step asked of it, so steps on one page run in turn. */
	last: Promise<unknown>;
	idle: ReturnType<typeof setTimeout> | undefined;
}

interface StepValue {
	readonly rect?: { x: number; y: number; width: number; height: number };
	readonly height?: number;
}

/**
 * Renders pages in windows that are never shown, so a capture does not
 * scroll, resize or switch the window the user is working in. A page is as
 * tall as its content asks, whatever the screen's height.
 */
export class HiddenPageRenderer {

	private readonly pages = new Map<string, HiddenPage>();

	async render(options: IHiddenPageRender): Promise<IHiddenPageResult> {
		const page = this.pages.get(options.key) ?? this.open(options);
		clearTimeout(page.idle);

		const step = page.last.catch(() => undefined).then(() => this.step(page, options));
		page.last = step;

		try {
			return await step;
		} catch (error) {
			this.close(options.key);
			throw error;
		} finally {
			if (this.pages.get(options.key) === page) {
				page.idle = setTimeout(() => this.close(options.key), IDLE_MS);
			}
		}
	}

	private open(options: IHiddenPageRender): HiddenPage {
		const window = new BrowserWindow({
			show: false,
			width: options.width,
			height: START_HEIGHT,
			useContentSize: true,
			enableLargerThanScreen: true,
			skipTaskbar: true,
			focusable: false,
			webPreferences: {
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				// Never shown, it must still run its frames.
				backgroundThrottling: false,
				...(options.zoomFactor && { zoomFactor: options.zoomFactor }),
			},
		});

		// The page shares its origin's zoom with the windows the user sees, so
		// its window is sized in their pixels to give the page its own width.
		const ready = window.loadURL(options.url)
			.then(() => window.setContentSize(Math.round(options.width * window.webContents.getZoomFactor()), START_HEIGHT))
			.then(() => window.webContents.executeJavaScript(options.setup, true))
			.then((value: StepValue | undefined) => { this.grow(window, value?.height); });

		const page: HiddenPage = { window, ready, last: Promise.resolve(), idle: undefined };
		this.pages.set(options.key, page);
		window.on('closed', () => {
			if (this.pages.get(options.key) === page) {
				this.pages.delete(options.key);
			}
		});

		return page;
	}

	private async step(page: HiddenPage, options: IHiddenPageRender): Promise<IHiddenPageResult> {
		await page.ready;

		const { webContents } = page.window;
		let value: StepValue | undefined = await webContents.executeJavaScript(options.step, true);

		// A page taller than its window is shown again once the window holds all of it.
		if (this.grow(page.window, value?.height)) {
			value = await webContents.executeJavaScript(options.step, true);
		}

		if (!value?.rect || value.rect.width < 1 || value.rect.height < 1) {
			return { value };
		}

		const zoom = webContents.getZoomFactor();
		let image = await webContents.capturePage({
			x: Math.round(value.rect.x * zoom),
			y: Math.round(value.rect.y * zoom),
			width: Math.round(value.rect.width * zoom),
			height: Math.round(value.rect.height * zoom),
		});

		const { width, height } = image.getSize();
		if (options.maxEdge && Math.max(width, height) > options.maxEdge) {
			image = image.resize(width >= height ? { width: options.maxEdge, quality: 'best' } : { height: options.maxEdge, quality: 'best' });
		}

		return { value, png: image.isEmpty() ? undefined : image.toPNG().toString('base64') };
	}

	/** Makes the window as tall as the page, given in the page's pixels; true when it grew. */
	private grow(window: BrowserWindow, height: number | undefined): boolean {
		const wanted = Math.ceil(Math.min(MAX_HEIGHT, height ?? 0) * window.webContents.getZoomFactor());
		const [width, current] = window.getContentSize();
		if (wanted <= current) {
			return false;
		}

		window.setContentSize(width, wanted);
		return true;
	}

	private close(key: string): void {
		const page = this.pages.get(key);
		if (!page) {
			return;
		}

		clearTimeout(page.idle);
		this.pages.delete(key);
		if (!page.window.isDestroyed()) {
			page.window.destroy();
		}
	}
}
