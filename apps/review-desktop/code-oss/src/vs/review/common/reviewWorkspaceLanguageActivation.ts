import { ExtensionIdentifier, type IExtensionDescription } from "../../platform/extensions/common/extensions.js";

export function reviewWorkspaceLanguageEvent(languageId: string): string {
	return `onReviewWorkspaceLanguage:${languageId}`;
}

export function rewriteReviewActivationEvents(desc: Pick<IExtensionDescription, "identifier">, activationEvents: string[]): string[] {
	if (ExtensionIdentifier.toKey(desc.identifier) !== "rust-lang.rust-analyzer") return activationEvents;
	// rust-analyzer captures its workspace on activation, so wait until the checkout is a folder.
	return [...activationEvents.filter(event => event !== "onLanguage:rust"), reviewWorkspaceLanguageEvent("rust")];
}
