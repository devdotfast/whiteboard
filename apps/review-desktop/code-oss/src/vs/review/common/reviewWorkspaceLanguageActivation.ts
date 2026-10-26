import { ExtensionIdentifier, type IExtensionDescription } from "../../platform/extensions/common/extensions.js";

export function reviewWorkspaceLanguageEvent(languageId: string): string {
	return `onReviewWorkspaceLanguage:${languageId}`;
}

// These extensions capture their workspace on activation, so wait until the checkout is a folder.
const workspaceLanguages: Record<string, string> = {
	"rust-lang.rust-analyzer": "rust",
	"astral-sh.ty": "python",
};

export function rewriteReviewActivationEvents(desc: Pick<IExtensionDescription, "identifier">, activationEvents: string[]): string[] {
	const languageId = workspaceLanguages[ExtensionIdentifier.toKey(desc.identifier)];
	if (!languageId) return activationEvents;
	return [...activationEvents.filter(event => event !== `onLanguage:${languageId}`), reviewWorkspaceLanguageEvent(languageId)];
}
