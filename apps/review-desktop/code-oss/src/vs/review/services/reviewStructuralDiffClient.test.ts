import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReviewSourceView } from '../common/reviewProtocol.js';
import type { StructuralEvent } from '../common/reviewStructuralDiff.js';
import { StructuralDiffClient } from './reviewStructuralDiffClient.js';

const file = { rhs: { path: 'a.ts', oid: 'abc', mode: '100644' } };
const start: StructuralEvent = { type: 'start', version: 4, lhs: { type: 'empty_tree' }, rhs: { type: 'revision', rev: 'head' }, files: [{ file, status: 'added' }] };
const result: StructuralEvent = { type: 'file', file, diff: { type: 'text', structural_changes: { base: [], head: [[0, 1]] }, rhs: { text: 'é a\u2028b\u2029c 🙂\n', regions: [] }, stats: { textual: { added: 1, removed: 0 }, visible: { added: 1, removed: 0 } } } };
const complete: StructuralEvent = { type: 'complete', succeeded: 1, failed: 0 };

function client() {
	const connection = { getConnection: async () => ({ serverUrl: 'http://localhost:5570', token: 'secret' }) };
	return new StructuralDiffClient(connection as never, resolveReviewSourceView({ reviewId: 'review-a', version: 4, pins: {} }));
}

function respond(bytes: Uint8Array, size: number) {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
			controller.close();
		},
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}

async function collect(stream: AsyncIterable<StructuralEvent>) {
	const events: StructuralEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

// JSON.stringify leaves U+2028 and U+2029 unescaped, as the host does.
test('streams every event whole when chunks split records and UTF-8 characters', async (t) => {
	const bytes = new TextEncoder().encode([start, result, complete].map(event => JSON.stringify(event)).join('\n'));
	for (const size of [1, 2, 3, 5, bytes.length]) {
		t.mock.method(globalThis, 'fetch', async () => respond(bytes, size));
		assert.deepEqual(await collect(client().streamComparison(new AbortController().signal)), [start, result, complete], `chunk size ${size}`);
	}
});

test('an error record fails the stream with its message', async (t) => {
	const bytes = new TextEncoder().encode(`${JSON.stringify(start)}\n${JSON.stringify({ type: 'error', message: 'diffr exited with code 3.' })}\n`);
	t.mock.method(globalThis, 'fetch', async () => respond(bytes, bytes.length));
	const events: StructuralEvent[] = [];
	await assert.rejects(async () => { for await (const event of client().streamComparison(new AbortController().signal)) events.push(event); }, { message: 'diffr exited with code 3.' });
	assert.deepEqual(events, [start]);
});
