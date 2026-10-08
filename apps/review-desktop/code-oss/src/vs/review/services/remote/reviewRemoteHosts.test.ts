import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Emitter } from "../../../base/common/event.js";
import { NullLogService } from "../../../platform/log/common/log.js";
import type { ReviewRemoteLanguageEndpoint } from "../reviewDesktopConnectionService.js";
import { ReviewRemoteHostsService } from "./reviewRemoteHosts.js";

const SERVER_ID = "3480c31a-77f0-4d6e-9a53-1b2c3d4e5f60";

function service() {
	const asked: string[] = [];
	const shutdown = new Emitter<{ join(promise: Promise<void>, joiner: unknown): void }>();
	const joined: Promise<void>[] = [];
	const target = new ReviewRemoteHostsService(
		{} as never,
		{
			getRemoteLanguageEndpoint: async (serverId: string): Promise<ReviewRemoteLanguageEndpoint | undefined> => {
				asked.push(serverId);
				return undefined;
			},
			readRemoteHosts: async () => [],
		} as never,
		{} as never,
		new NullLogService(),
		{ registerProvider: () => ({ dispose() { } }) } as never,
		{ onWillShutdown: shutdown.event } as never,
	);
	const shut = () => shutdown.fire({ join: (promise) => joined.push(promise) });
	return { target, asked, shut, joined };
}

test("shutdown and reload close every host, and none is created afterwards", async (t) => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => mock.timers.reset());
	const { target, asked, shut, joined } = service();
	await target.host(SERVER_ID);
	shut();
	await Promise.all(joined);
	assert.equal(joined.length, 1);
	mock.timers.tick(60_000);
	for (let i = 0; i < 10; i++) await Promise.resolve();
	assert.equal(await target.host(SERVER_ID), undefined);
	assert.deepEqual(asked, [SERVER_ID], "no retry after the host closed");
	target.dispose();
});
