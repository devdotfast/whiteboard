import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';
import { reviewWorkspaceLanguageEvent, rewriteReviewActivationEvents } from './reviewWorkspaceLanguageActivation.js';

const extension = (id: string) => ({ identifier: new ExtensionIdentifier(id) });

test('rust-analyzer waits for the review checkout instead of the first Rust model', () => {
	const events = rewriteReviewActivationEvents(extension('Rust-Lang.Rust-Analyzer'), [
		'workspaceContains:Cargo.toml',
		'onLanguage:rust',
		'onCommand:rust-analyzer.analyzerStatus',
	]);
	assert.deepEqual(events, [
		'workspaceContains:Cargo.toml',
		'onCommand:rust-analyzer.analyzerStatus',
		reviewWorkspaceLanguageEvent('rust'),
	]);
});

test('ty waits for the review checkout instead of falling back to its working directory', () => {
	const events = rewriteReviewActivationEvents(extension('astral-sh.ty'), [
		'onLanguage:python',
		'workspaceContains:*.py',
	]);
	assert.deepEqual(events, ['workspaceContains:*.py', reviewWorkspaceLanguageEvent('python')]);
});

test('other language extensions keep their activation events', () => {
	const events = ['onLanguage:python', 'workspaceContains:pyproject.toml'];
	assert.deepEqual(rewriteReviewActivationEvents(extension('ms-python.python'), events), events);
});
