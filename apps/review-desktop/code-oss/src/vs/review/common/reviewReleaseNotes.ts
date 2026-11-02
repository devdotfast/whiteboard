/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReviewCanvasRelease, WHITEBOARD_RELEASES_API_URL, whiteboardReleaseApiUrl } from './reviewProtocol.js';

/** Opens the Release notes tab: for the version given, else the running one. */
export const REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID = 'review.showReleaseNotes';

async function fetchGitHub<T>(url: string, notFound: string): Promise<T> {
	const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
	if (!response.ok) {
		throw new Error(response.status === 404 ? notFound : `GitHub answered ${response.status}.`);
	}
	return response.json();
}

export function fetchWhiteboardRelease(version: string): Promise<ReviewCanvasRelease> {
	return fetchGitHub(whiteboardReleaseApiUrl(version), `Whiteboard ${version} has no release notes yet.`);
}

/** diffr releases share the repository under other tags. */
export async function fetchWhiteboardReleases(): Promise<ReviewCanvasRelease[]> {
	const releases = await fetchGitHub<(ReviewCanvasRelease & { prerelease: boolean })[]>(WHITEBOARD_RELEASES_API_URL, 'Whiteboard has no release notes yet.');
	return releases.filter(release => /^v\d/.test(release.tag_name) && !release.prerelease);
}
