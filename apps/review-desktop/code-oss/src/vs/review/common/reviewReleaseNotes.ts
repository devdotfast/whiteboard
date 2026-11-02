/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReviewCanvasRelease, WHITEBOARD_RELEASES_API_URL } from './reviewProtocol.js';

/** Opens the Release notes tab: for the version given, else the running one. */
export const REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID = 'review.showReleaseNotes';

/** diffr releases share the repository under other tags. */
export async function fetchWhiteboardReleases(): Promise<ReviewCanvasRelease[]> {
	const response = await fetch(WHITEBOARD_RELEASES_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
	if (!response.ok) {
		throw new Error(`GitHub answered ${response.status}.`);
	}
	const releases: (ReviewCanvasRelease & { prerelease: boolean })[] = await response.json();
	return releases.filter(release => /^v\d/.test(release.tag_name) && !release.prerelease);
}
