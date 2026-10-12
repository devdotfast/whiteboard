/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTrustedTypesPolicy } from "../../../../base/browser/trustedTypes.js";
import { FileAccess } from "../../../../base/common/network.js";
import type { ReviewCanvasModule, ReviewRuntimeConfig } from "../../../common/reviewProtocol.js";

/** The canvas bundle: the canvas and the sidebar sections mount from it. */
export interface ReviewCanvasAssetsModule extends ReviewCanvasModule {
	readonly clearReviewViewState: (config: ReviewRuntimeConfig) => void;
	readonly reviewWasmUrl: string;
	readonly reviewStylesheetUrls: readonly string[];
}

interface ReviewCanvasGlobalThis {
	__zod_globalConfig?: {
		jitless?: boolean;
	};
}

const reviewCanvasPolicy = createTrustedTypesPolicy("reviewCanvas", {
	createScriptURL: (value: string) => value,
});

let assetsPromise: Promise<ReviewCanvasAssetsModule> | null = null;

/** Imports the canvas bundle once for the window, and its stylesheets. */
export function loadReviewCanvasAssets(): Promise<ReviewCanvasAssetsModule> {
	assetsPromise ??= importAssets().catch((error) => {
		assetsPromise = null;
		throw error;
	});
	return assetsPromise;
}

async function importAssets(): Promise<ReviewCanvasAssetsModule> {
	// Zod 4 probes the Function constructor unless its CSP-safe mode is set
	// before the canvas module graph is evaluated. Chromium reports the caught
	// probe as a Trusted Types violation, so configure the bundled authoring
	// runtime before importing it instead of weakening the workbench policy.
	const canvasGlobal = globalThis as ReviewCanvasGlobalThis;
	canvasGlobal.__zod_globalConfig ??= {};
	canvasGlobal.__zod_globalConfig.jitless = true;

	const url = FileAccess.asBrowserUri("vs/review/canvas/canvas-loader.js").toString(true);
	const trustedUrl = reviewCanvasPolicy?.createScriptURL(url) ?? (url as string);
	const assets = (await import(
		/* webpackIgnore: true */ trustedUrl as unknown as string
	)) as ReviewCanvasAssetsModule;
	if (typeof assets.mountReviewCanvas !== "function") {
		throw new Error("Whiteboard canvas bundle has no mount function.");
	}
	await Promise.all(assets.reviewStylesheetUrls.map((stylesheet) => loadStylesheet(document, stylesheet)));
	return assets;
}

function loadStylesheet(document: Document, url: string): Promise<void> {
	const existing = [...document.querySelectorAll<HTMLLinkElement>('link[data-review-canvas-stylesheet="true"]')].find(
		(link) => link.href === url,
	);
	if (existing) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		link.dataset["reviewCanvasStylesheet"] = "true";
		link.addEventListener("load", () => resolve(), { once: true });
		link.addEventListener("error", () => reject(new Error(`Whiteboard canvas stylesheet failed: ${url}`)), { once: true });
		document.head.appendChild(link);
	});
}
