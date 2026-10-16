/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { boardsToClose, keepOneGroup, letGoOfUntitled } from './reviewOneBoard.js';

test('the active board and the nine before it stay open; older boards and left Untitled ones close', () => {
	const behind = Array.from({ length: 12 }, (_, index) => `b${index + 1}`);
	const closing = boardsToClose(behind, (board) => board === 'b2');

	assert.deepEqual(closing, ['b2', 'b10', 'b11', 'b12']);
	assert.deepEqual(boardsToClose(['a', 'b'], () => false), []);
});

test('a closing window closes its Untitled boards first, then has each discarded', async () => {
	const order: string[] = [];

	await letGoOfUntitled(
		['new-1', 'new-2'],
		async () => { order.push('close'); },
		async (reviewId) => {
			order.push(`discard ${reviewId}`);
			// A board already discarded by its editor closing answers 404.
			if (reviewId === 'new-2') throw new Error('Not found');
		},
	);

	assert.deepEqual(order, ['close', 'discard new-1', 'discard new-2']);
});

test('a closing window waits for a slow discard only so long', async () => {
	const started = Date.now();

	await letGoOfUntitled(['new'], async () => { }, () => new Promise(() => { }), 50);
	assert.ok(Date.now() - started < 1000);
});

test('with no Untitled board, closing the window does nothing', async () => {
	let closed = false;

	await letGoOfUntitled([], async () => { closed = true; }, async () => { });
	assert.equal(closed, false);
});

test('a window of more than one editor group, from a split or a restored layout, merges back into the group on show', () => {
	const groups = [{ id: 1, boards: ['a'] }, { id: 2, boards: ['b'] }, { id: 3, boards: ['c'] }];
	const window = {
		get groups() { return groups; },
		activeGroup: groups[1]!,
		mergeGroup(source: (typeof groups)[number], target: (typeof groups)[number]) {
			target.boards.push(...source.boards);
			groups.splice(groups.indexOf(source), 1);
		},
	};

	keepOneGroup(window);

	assert.deepEqual(groups, [{ id: 2, boards: ['b', 'a', 'c'] }]);
});
