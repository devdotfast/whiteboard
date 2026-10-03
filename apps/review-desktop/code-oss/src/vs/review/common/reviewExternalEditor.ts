/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute } from "../../base/common/path.js";
import { URI } from "../../base/common/uri.js";

/** URL schemes that open `file/<path>:<line>:<column>` in each `review.openFilesIn` editor. */
const EXTERNAL_EDITOR_SCHEMES: Readonly<Record<string, string>> = {
	vscode: "vscode",
	cursor: "cursor",
	zed: "zed",
};

/** A file the renderer asks the main process to open in the reader's editor. */
export interface ReviewExternalEditorTarget {
	readonly editor: string;
	readonly filePath: string;
	readonly line?: number;
	readonly column?: number;
}

export function isExternalEditor(editor: string | undefined): editor is string {
	return !!editor && Object.hasOwn(EXTERNAL_EDITOR_SCHEMES, editor);
}

/** The editor's URL for the target, or undefined for anything but an absolute file in a known editor. */
export function externalEditorUrl({ editor, filePath, line, column }: ReviewExternalEditorTarget): string | undefined {
	if (!isExternalEditor(editor) || typeof filePath !== "string" || !isAbsolute(filePath)) return undefined;
	const encodedPath = URI.file(filePath).path.split("/").map(encodeURIComponent).join("/");
	const position = isLineNumber(line) ? `:${line}:${isLineNumber(column) ? column : 1}` : "";
	return `${EXTERNAL_EDITOR_SCHEMES[editor]}://file${encodedPath}${position}`;
}

function isLineNumber(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
