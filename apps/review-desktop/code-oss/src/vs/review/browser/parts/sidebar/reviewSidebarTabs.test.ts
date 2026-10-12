/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { type ReviewSidebarPaneId, ReviewSidebarTabs } from './reviewSidebarTabs.js';

test('a tab asks for its view, and the view coming back keeps it lit', () => {
	const tabs = new ReviewSidebarTabs(() => true);
	tabs.follow('review');

	assert.equal(tabs.pick('diff', 'review'), 'diff');
	assert.equal(tabs.active, 'diff');
	tabs.follow('diff');
	assert.equal(tabs.active, 'diff');

	// Picking the tab of the view on screen asks for nothing.
	assert.equal(tabs.pick('diff', 'diff'), undefined);
});

test('Threads switches only the pane, and holds until the view changes', () => {
	const tabs = new ReviewSidebarTabs(() => true);
	tabs.follow('review');

	assert.equal(tabs.pick('threads', 'review'), undefined);
	assert.equal(tabs.active, 'threads');
	tabs.follow('review');
	assert.equal(tabs.active, 'threads');

	tabs.follow('diff');
	assert.equal(tabs.active, 'diff');
});

test('Trace and Map light Whiteboard', () => {
	const tabs = new ReviewSidebarTabs(() => true);

	tabs.follow('trace');
	assert.equal(tabs.active, 'whiteboard');
	tabs.follow('map');
	assert.equal(tabs.active, 'whiteboard');
});

test('a tab the board does not have is never picked, and one that goes away falls back to Whiteboard', () => {
	const offered = new Set<ReviewSidebarPaneId>(['whiteboard', 'threads']);
	const tabs = new ReviewSidebarTabs((id) => offered.has(id));
	tabs.follow('review');

	assert.equal(tabs.pick('diff', 'review'), undefined);
	assert.equal(tabs.active, 'whiteboard');

	offered.add('diff');
	tabs.pick('diff', 'review');
	tabs.follow('diff');
	offered.delete('diff');
	tabs.follow('diff');
	assert.equal(tabs.active, 'whiteboard');
});
