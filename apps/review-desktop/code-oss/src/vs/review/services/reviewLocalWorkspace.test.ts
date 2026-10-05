import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from '../../base/common/uri.js';
import { acquireReviewLanguageRoot, reviewLanguageRoot } from './reviewLocalWorkspace.js';

function workspace() {
	const folders: string[] = [];
	const counts: number[] = [];
	return {
		folders, counts,
		async addFolders(added: { uri: URI }[]) { folders.push(...added.map(({ uri }) => uri.toString())); counts.push(folders.length); },
		async removeFolders(removed: URI[]) {
			for (const uri of removed) folders.splice(folders.indexOf(uri.toString()), 1);
			counts.push(folders.length);
		},
	};
}

// dispose() queues its folder change; the next acquire runs after it.
const settled = (target: ReturnType<typeof workspace>) => acquireReviewLanguageRoot(target, URI.file('/settle'));

const a = URI.file('/checkouts/a');
const b = URI.file('/checkouts/b');

test('the last released checkout stays a folder, so rust-analyzer keeps its server', async () => {
	const target = workspace();
	(await acquireReviewLanguageRoot(target, a)).dispose();
	const next = await acquireReviewLanguageRoot(target, a);
	assert.deepEqual(target.folders, [a.toString()]);
	assert.deepEqual(target.counts, [1]);
	next.dispose();
});

test('a new checkout replaces the kept one without emptying the folder list', async () => {
	const target = workspace();
	(await acquireReviewLanguageRoot(target, a)).dispose();
	await acquireReviewLanguageRoot(target, b);
	assert.deepEqual(target.folders, [b.toString()]);
	assert.ok(target.counts.every(count => count > 0));
});

test('a checkout released while another is open is removed', async () => {
	const target = workspace();
	const first = await acquireReviewLanguageRoot(target, a);
	await acquireReviewLanguageRoot(target, b);
	first.dispose();
	await settled(target);
	assert.deepEqual(target.folders, [b.toString(), URI.file('/settle').toString()]);
});

test('a shared checkout stays until its last owner releases it', async () => {
	const target = workspace();
	const first = await acquireReviewLanguageRoot(target, a);
	const second = await acquireReviewLanguageRoot(target, a);
	await acquireReviewLanguageRoot(target, b);
	first.dispose();
	await settled(target);
	assert.ok(target.folders.includes(a.toString()));
	second.dispose();
	await settled(target);
	assert.ok(!target.folders.includes(a.toString()));
});

const SERVER_ID = '6F23D55B-8446-437e-afd6-ad3a40eecc4c';

test('no root while a checkout is prepared, or for a server id that is not an id', () => {
	assert.equal(reviewLanguageRoot({ remoteRootPath: null, identity: 'hash', serverId: SERVER_ID }), undefined);
	assert.equal(reviewLanguageRoot({ remoteRootPath: '/repo', identity: 'hash', serverId: '../x' }), undefined);
	assert.equal(reviewLanguageRoot({ rootPath: null, identity: 'id' }), undefined);
	assert.equal(reviewLanguageRoot(undefined), undefined);
});
