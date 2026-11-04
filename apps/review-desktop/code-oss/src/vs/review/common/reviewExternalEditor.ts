/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute } from "../../base/common/path.js";
import { URI } from "../../base/common/uri.js";

/** Each `review.openFilesIn` editor's URL scheme. */
const EXTERNAL_EDITOR_SCHEMES: Readonly<Record<string, string>> = {
	vscode: "vscode",
	cursor: "cursor",
	zed: "zed",
	intellij: "idea",
};

/** A file the renderer asks the main process to open in the reader's editor. */
export interface ReviewExternalEditorTarget {
	readonly editor: string;
	readonly filePath: string;
	readonly line?: number;
	readonly column?: number;
	/** The checkout the editor opens as its workspace, so the file arrives with its tree. */
	readonly folder?: string;
}

export function isExternalEditor(editor: string | undefined): editor is string {
	return !!editor && Object.hasOwn(EXTERNAL_EDITOR_SCHEMES, editor);
}

/** The editor's URL for the target, or undefined for anything but an absolute file in a known editor. */
export function externalEditorUrl({ editor, filePath, line, column }: ReviewExternalEditorTarget): string | undefined {
	if (!isExternalEditor(editor) || typeof filePath !== "string" || !isAbsolute(filePath)) return undefined;
	const scheme = EXTERNAL_EDITOR_SCHEMES[editor];
	// IntelliJ counts columns from 0.
	if (scheme === "idea") {
		const query = new URLSearchParams({ file: filePath });
		if (isLineNumber(line)) {
			query.set("line", String(line));
			query.set("column", String(isLineNumber(column) ? column - 1 : 0));
		}
		return `idea://open?${query}`;
	}
	const encodedPath = URI.file(filePath).path.split("/").map(encodeURIComponent).join("/");
	return `${scheme}://file${encodedPath}${editorPosition(line, column)}`;
}

/** The `:<line>:<column>` suffix editors read after a path, or nothing without a line. */
export function editorPosition(line: number | undefined, column: number | undefined): string {
	return isLineNumber(line) ? `:${line}:${isLineNumber(column) ? column : 1}` : "";
}

export function isLineNumber(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
