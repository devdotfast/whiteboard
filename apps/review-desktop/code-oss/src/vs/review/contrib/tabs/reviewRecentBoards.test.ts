/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { RECENT_CYCLE_MS, RecentCycle, recentBoardIds } from './reviewRecentBoards.js';

const board = (reviewId: string, day: number | null, project = 'app', trashed = false) => ({
	reviewId,
	viewedAt: day === null ? null : `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
	trashedAt: trashed ? '2026-10-12T00:00:00Z' : null,
	project: { id: project },
});

test("recent boards are the open board's project's, opened newest first, without ones in Trash", () => {
	const boards = [
		board('a', 3), board('b', 9), board('never', null), board('gone', 10, 'app', true), board('c', 5),
		board('elsewhere', 11, 'other'),
	];

	assert.deepEqual(recentBoardIds(boards, 'a'), ['b', 'c', 'a']);
	assert.deepEqual(recentBoardIds(boards, 'elsewhere'), ['elsewhere']);
});

test('Ctrl+Tab walks further back on each quick press, and starts over after a pause', () => {
	let time = 0;
	const cycle = new RecentCycle(() => time);
	// Opening a board moves it to the front, as the server records the view.
	let order = ['a', 'b', 'c', 'd'];
	const open = (id: string | undefined) => {
		order = [id!, ...order.filter((each) => each !== id)];
		return id;
	};

	assert.equal(open(cycle.step('a', () => order, 1)), 'b');
	time += 300;
	assert.equal(open(cycle.step('b', () => order, 1)), 'c');
	time += 300;
	assert.equal(open(cycle.step('c', () => order, -1)), 'b');

	// After a pause the walk starts from the list as it is now.
	time += RECENT_CYCLE_MS + 1;
	assert.equal(cycle.step('b', () => order, 1), 'c');
});

test('Ctrl+Tab with no other board opens nothing', () => {
	assert.equal(new RecentCycle(() => 0).step('a', () => ['a'], 1), undefined);
});
