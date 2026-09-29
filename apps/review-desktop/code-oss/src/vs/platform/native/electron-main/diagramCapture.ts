/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, clipboard } from 'electron';
import { Sequencer } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { IClipboardCapturePage } from '../common/native.js';

/** Renders each diagram snapshot in a temporary window without showing or focusing it. */
export class DiagramCapture extends Disposable {

	private readonly queue = new Sequencer();
	private window: BrowserWindow | undefined;
	private owner: BrowserWindow | undefined;
	private readonly ownerClosed = () => this.destroyWindow();

	capture(owner: BrowserWindow, page: IClipboardCapturePage): Promise<void> {
		if (
			!Number.isInteger(page.width) || !Number.isInteger(page.height) ||
			page.width <= 0 || page.height <= 0 || page.width > 2048 || page.height > 2048 ||
			typeof page.html !== 'string' || typeof page.background !== 'string' ||
			!Array.isArray(page.styles) || page.styles.some(style => !style || (typeof style.href !== 'string' && typeof style.css !== 'string')) ||
			Buffer.byteLength(JSON.stringify(page)) > 20 * 1024 * 1024
		) {
			return Promise.reject(new Error('Invalid hidden diagram capture.'));
		}
		return this.queue.queue(async () => {
			if (owner.isDestroyed()) throw new Error('Diagram window is no longer available.');
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const image = await Promise.race([
					this.render(owner, page),
					new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Hidden diagram capture timed out.')), 15000); })
				]);
				if (owner.isDestroyed()) throw new Error('Diagram window is no longer available.');
				if (image.isEmpty()) throw new Error('Could not capture the diagram.');
				clipboard.writeImage(image);
			} finally {
				clearTimeout(timer);
				this.destroyWindow();
			}
		});
	}

	private async render(owner: BrowserWindow, page: IClipboardCapturePage) {
		this.owner = owner;
		owner.once('closed', this.ownerClosed);
		const bounds = owner.getBounds();
		const window = this.window = new BrowserWindow({
			show: false, focusable: false, skipTaskbar: true, frame: false,
			// Allow exports taller or wider than the physical display on macOS.
			enableLargerThanScreen: true,
			// Place on the same display to keep the native pixel density comparable.
			x: bounds.x, y: bounds.y, width: page.width, height: page.height,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
		});
		window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
		await window.loadURL(FileAccess.asBrowserUri('vs/review/canvas/diagram-capture.html').toString(true));
		// Respect Chromium's zoom for this origin without changing the workbench's zoom.
		const zoom = window.webContents.getZoomFactor();
		const width = Math.ceil(page.width * zoom);
		const height = Math.ceil(page.height * zoom);
		window.setContentSize(width, height);
		await window.webContents.executeJavaScript(`window.renderDiagramCapture(${JSON.stringify(page)})`);
		return window.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true });
	}

	private destroyWindow(): void {
		this.owner?.removeListener('closed', this.ownerClosed);
		this.owner = undefined;
		if (this.window && !this.window.isDestroyed()) this.window.destroy();
		this.window = undefined;
	}

	override dispose(): void {
		this.destroyWindow();
		super.dispose();
	}
}
