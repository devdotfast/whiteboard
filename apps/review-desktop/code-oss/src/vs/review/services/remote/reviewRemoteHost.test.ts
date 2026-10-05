import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { URI } from "../../../base/common/uri.js";
import { NullLogService } from "../../../platform/log/common/log.js";
import { type IReviewRemoteSession, ReviewRemoteHost } from "./reviewRemoteHost.js";

const AUTHORITY = "whiteboard+aaaa-1111";

function session() {
	let fail!: (reason: string) => void;
	const failed = new Promise<string>((resolve) => (fail = resolve));
	const value = {
		failed,
		activated: [] as string[],
		disposed: false,
		closed: false,
		async activateByEvent(event: string) { value.activated.push(event); },
		async close() { value.closed = true; },
		dispose() { value.disposed = true; },
	};
	return { value: value as IReviewRemoteSession & typeof value, fail };
}

function host(script: (() => IReviewRemoteSession | undefined | Error)[]) {
	const opens: number[] = [];
	const target = new ReviewRemoteHost("aaaa-1111", AUTHORITY, async () => {
		opens.push(Date.now());
		const next = script.shift()?.();
		if (next instanceof Error) throw next;
		return next;
	}, new NullLogService());
	return { target, opens };
}

async function settle() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("while the endpoint is missing or the connect fails, the host tries again after each delay, then connects", async (t) => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => mock.timers.reset());
	const connected = session();
	const { target, opens } = host([() => undefined, () => new Error("WebSocket close with status code 1006"), () => undefined, () => connected.value]);

	assert.equal(await target.connect(), false, "the first ask gets undefined, not a hang");
	for (const step of [1_000, 2_000, 4_000]) {
		mock.timers.tick(step);
		await settle();
	}
	assert.deepEqual(opens, [0, 1_000, 3_000, 7_000]);
	assert.equal(await target.connect(), true);
	assert.equal(opens.length, 4, "a connected host does not open again");
	target.dispose();
	assert.equal(connected.value.disposed, true);
});

test("a failed session is replaced after a delay, with the roots and activation events carried over", async (t) => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => mock.timers.reset());
	const first = session();
	const second = session();
	const { target, opens } = host([() => first.value, () => second.value]);

	assert.equal(await target.connect(), true);
	const root = await target.addRoot(URI.parse(`vscode-remote://${AUTHORITY}/home/dev/proj`));
	await target.activateByEvent("onLanguage:typescript");
	first.fail("the Management connection");
	await settle();
	assert.equal(first.value.disposed, true, "the whole session ends, both connections");
	assert.equal(await target.connect(), false, "asking again during the delay neither connects nor waits");
	mock.timers.tick(999);
	await settle();
	assert.equal(opens.length, 1);
	mock.timers.tick(1);
	await settle();
	assert.equal(opens.length, 2);
	assert.deepEqual(second.value.activated, ["onLanguage:typescript"]);
	assert.deepEqual(target.workspace.getWorkspace().folders.map((folder) => folder.uri.path), ["/home/dev/proj"]);
	root.dispose();
	target.dispose();
});

test("a root on another machine is refused, and a closed host stops trying and closes its session", async (t) => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => mock.timers.reset());
	const only = session();
	const { target, opens } = host([() => undefined, () => only.value]);

	await assert.rejects(target.addRoot(URI.parse("vscode-remote://whiteboard+bbbb-2222/home/dev/proj")));
	await assert.rejects(target.addRoot(URI.file("/home/dev/proj")));
	assert.equal(await target.connect(), false);
	await target.close();
	mock.timers.tick(60_000);
	await settle();
	assert.equal(opens.length, 1);
	assert.equal(await target.connect(), false);

	const connected = host([() => only.value]);
	await connected.target.connect();
	await connected.target.close();
	assert.deepEqual([only.value.closed, only.value.disposed], [true, true]);
});

test("a reload during a first connect waits for it, then closes that session: no extension host is left behind", async () => {
	const late = session();
	let resolveOpen!: (value: IReviewRemoteSession) => void;
	let opens = 0;
	const target = new ReviewRemoteHost("aaaa-1111", AUTHORITY, () => {
		opens++;
		return new Promise<IReviewRemoteSession>((resolve) => (resolveOpen = resolve));
	}, new NullLogService());
	const connecting = target.connect();
	const closing = target.close();
	resolveOpen(late.value);
	await closing;
	assert.equal(await connecting, true);
	assert.deepEqual([late.value.closed, late.value.disposed, opens], [true, true, 1]);
	assert.equal(await target.connect(), false);
	assert.equal(opens, 1);
});
