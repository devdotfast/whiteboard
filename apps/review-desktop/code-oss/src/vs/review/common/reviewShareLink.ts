/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

export function shareUrlFromDeepLink(path: string, query: string): string {
	const params = new URLSearchParams(query);
	const url = new URL(`/s${path}`, params.get("origin") ?? "https://app.dev.fast");
	const rev = params.get("rev");
	if (rev) url.searchParams.set("rev", rev);
	return url.href;
}
