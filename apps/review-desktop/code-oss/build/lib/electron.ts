/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import vfs from 'vinyl-fs';
import { filter, jsonEditor } from './gulp/facade.ts';
import * as util from './util.ts';
import { getVersion } from './getVersion.ts';
import { downloadFeedPackage } from './azureFeed.ts';
import electron from '@vscode/gulp-electron';

const root = path.dirname(path.dirname(import.meta.dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const commit = getVersion(root);
const useVersionedUpdate = process.platform === 'win32' && (product as typeof product & { win32VersionedUpdate?: boolean })?.win32VersionedUpdate;
const versionedResourcesFolder = useVersionedUpdate ? commit!.substring(0, 10) : '';

function createTemplate(input: string): (params: Record<string, string>) => string {
	return (params: Record<string, string>) => {
		return input.replace(/<%=\s*([^\s]+)\s*%>/g, (match, key) => {
			return params[key] || match;
		});
	};
}

const darwinCreditsTemplate = product.darwinCredits && createTemplate(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));

const { electronVersion, msBuildId } = util.getElectronVersion();

// In product builds, `@vscode/gulp-electron` is given an asset resolver (via the
// `repo` option) that fetches the prebuilt Electron archives on demand from the
// Azure Artifacts feed named by `product.electronArtifactFeed` using the `az`
// CLI, instead of downloading them from electron's official GitHub releases
// (which OSS builds use when no feed is configured). Each universal package
// contains exactly one file, which is streamed back as a `Response` and
// validated against the feed's `SHASUMS256.txt`.
const electronFeed: string | undefined = product.electronArtifactFeed;

// Maps the artifact file name `@vscode/gulp-electron` requests to the matching
// universal package name in the feed, or `undefined` when it is not mirrored.
function feedPackageName(fileName: string): string | undefined {
	if (fileName === 'SHASUMS256.txt') {
		return 'shasums256';
	}
	if (fileName.endsWith('-symbols.zip')) {
		return undefined;
	}
	return fileName.replace(/\.zip$/, '');
}

const electronAssetResolver = electronFeed
	? async ({ fileName }: { url: string; fileName: string }): Promise<Response> => {
		const name = feedPackageName(fileName);
		if (!name) {
			return new Response(null, { status: 404 });
		}
		const version = `${electronVersion}-${msBuildId}`;
		const filePath = await downloadFeedPackage(root, 'electron-feed', { feed: electronFeed, name, version });
		const size = (await fs.promises.stat(filePath)).size;
		const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
		return new Response(body, { status: 200, headers: { 'Content-Length': String(size) } });
	}
	: undefined;

export const config = {
	version: electronVersion,
	// Keep the bundle directory filesystem-safe. The branded name contains a
	// slash, so it belongs in display metadata rather than in a path.
	productAppName: product.nameShort,
	// CFBundleDisplayName, which is what titles the macOS application menu. The
	// window chrome carries no wordmark, so the brand lives here instead. The
	// bundle file name still comes from productAppName and the executable from
	// darwinExecutable, so packaging paths stay filesystem-safe.
	productDisplayName: product.nameLong,
	companyName: '/dev/fast',
	copyright: 'Copyright (C) 2026 /dev/fast',
	darwinExecutable: product.nameShort,
	darwinIcon: 'resources/darwin/code.icns',
	darwinBundleIdentifier: product.darwinBundleIdentifier,
	darwinApplicationCategoryType: 'public.app-category.developer-tools',
	darwinHelpBookFolder: 'VS Code HelpBook',
	darwinHelpBookName: 'VS Code HelpBook',
	darwinBundleURLTypes: [{
		role: 'Viewer',
		name: product.nameLong,
		urlSchemes: [product.urlProtocol]
	}],
	darwinBundleDocumentTypes: [{
		name: 'Whiteboard',
		role: 'Editor',
		ostypes: ['TEXT'],
		extensions: ['whiteboard'],
		iconFile: 'resources/darwin/code.icns'
	}],
	darwinForceDarkModeSupport: true,
	darwinCredits: darwinCreditsTemplate ? Buffer.from(darwinCreditsTemplate({ commit: commit, date: new Date().toISOString() })) : undefined,
	linuxExecutableName: product.applicationName,
	winIcon: 'resources/win32/code.ico',
	token: process.env['GITHUB_TOKEN'],
	repo: electronAssetResolver,
	validateChecksum: true,
	checksumFile: path.join(root, 'build', 'checksums', 'electron.txt'),
	createVersionedResources: useVersionedUpdate,
	productVersionString: versionedResourcesFolder,
};

function getElectron(arch: string): () => NodeJS.ReadWriteStream {
	return () => {
		const electronOpts = {
			...config,
			platform: process.platform,
			arch: arch === 'armhf' ? 'arm' : arch,
			ffmpegChromium: false,
			keepDefaultApp: true
		};

		return vfs.src('package.json')
			.pipe(jsonEditor({ name: product.nameShort }))
			.pipe(electron(electronOpts))
			.pipe(filter(['**', '!**/app/package.json']))
			.pipe(vfs.dest('.build/electron'));
	};
}

async function main(arch: string = process.arch): Promise<void> {
	const electronPath = path.join(root, '.build', 'electron');
	await util.rimraf(electronPath)();
	await util.streamToPromise(getElectron(arch)());
}

if (import.meta.main) {
	main(process.argv[2]).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
