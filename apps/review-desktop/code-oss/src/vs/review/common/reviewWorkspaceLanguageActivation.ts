import { ExtensionHostExtensions } from "../../workbench/services/extensions/common/extensions.js";
import { ExtensionIdentifier, type IExtensionDescription } from "../../platform/extensions/common/extensions.js";

export function reviewWorkspaceLanguageEvent(languageId: string): string {
	return `onReviewWorkspaceLanguage:${languageId}`;
}

export const reviewSnapshotExtensionIds = new Set([
	"vscode.typescript-language-features",
	"vscode.json-language-features",
	"vscode.css-language-features",
	"vscode.html-language-features",
	"rust-lang.rust-analyzer",
	"fwcd.kotlin",
	"golang.go",
	"swiftlang.swift-vscode",
	"muhammad-sammy.csharp",
	"ms-dotnettools.vscode-dotnet-runtime",
	"ms-python.python",
	"astral-sh.ty",
	"charliermarsh.ruff",
]);

export function rewriteReviewActivationEvents(desc: Pick<IExtensionDescription, "identifier">, activationEvents: string[]): string[] {
	const id = ExtensionIdentifier.toKey(desc.identifier);
	if (!reviewSnapshotExtensionIds.has(id)) return activationEvents;
	// Only snapshot hosts send these events. Native backing models also exist in
	// the window; they must not activate a second, shared language client there.
	return activationEvents.map((event) =>
		event.startsWith("onLanguage:") ? reviewWorkspaceLanguageEvent(event.slice("onLanguage:".length)) : `onReviewWorkspace:${event}`,
	);
}

/** Embedded workspaces restore normal VS Code activation, including eager events. */
export class ReviewWorkspaceHostExtensions extends ExtensionHostExtensions {
	override containsActivationEvent(event: string): boolean {
		return (
			super.containsActivationEvent(event) ||
			super.containsActivationEvent(
				event.startsWith("onLanguage:")
					? reviewWorkspaceLanguageEvent(event.slice("onLanguage:".length))
					: `onReviewWorkspace:${event}`,
			)
		);
	}

	override toSnapshot() {
		const snapshot = super.toSnapshot();
		for (const [id, events] of Object.entries(snapshot.activationEvents)) {
			snapshot.activationEvents[id] = events.map((event) =>
				event.startsWith("onReviewWorkspaceLanguage:")
					? `onLanguage:${event.slice("onReviewWorkspaceLanguage:".length)}`
					: event.startsWith("onReviewWorkspace:")
						? event.slice("onReviewWorkspace:".length)
						: event,
			);
		}
		return snapshot;
	}
}
