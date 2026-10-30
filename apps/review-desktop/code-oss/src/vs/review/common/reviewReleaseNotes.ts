/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReviewCanvasRelease, whiteboardReleaseApiUrl } from './reviewProtocol.js';

/** Opens the Release notes tab: for the version given, else the running one. */
export const REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID = 'review.showReleaseNotes';

export async function fetchWhiteboardRelease(version: string): Promise<ReviewCanvasRelease> {
	const response = await fetch(whiteboardReleaseApiUrl(version), { headers: { Accept: 'application/vnd.github+json' } });
	if (!response.ok) {
		throw new Error(response.status === 404 ? `Whiteboard ${version} has no release notes yet.` : `GitHub answered ${response.status}.`);
	}
	return response.json();
}
