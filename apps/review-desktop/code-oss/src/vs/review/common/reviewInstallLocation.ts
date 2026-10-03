/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ReviewInstallLocation = 'applications' | 'user_applications' | 'volume' | 'translocated' | 'other';

/**
 * Where a macOS build runs from, from any path inside its bundle. Squirrel
 * cannot update an app on a mounted volume or in its App Translocation copy,
 * so these values tell stuck installs apart from updatable ones. Only the
 * category leaves the machine, never the path.
 */
export function reviewInstallLocation(bundlePath: string): ReviewInstallLocation {
	// Gatekeeper runs a quarantined app opened from Downloads from a random read-only mount.
	if (bundlePath.includes('/AppTranslocation/')) {
		return 'translocated';
	}
	if (bundlePath.startsWith('/Applications/')) {
		return 'applications';
	}
	if (/^\/Users\/[^/]+\/Applications\//.test(bundlePath)) {
		return 'user_applications';
	}
	// A mounted disk image or an external drive; the path cannot tell them apart.
	if (bundlePath.startsWith('/Volumes/')) {
		return 'volume';
	}
	return 'other';
}
