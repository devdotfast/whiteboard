/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_REMOTE_HOSTS_ENABLED_SETTING, REVIEW_REMOTE_HOSTS_SETTING } from "../common/reviewConfigurationDefaults.js";
import { reviewRemoteHostsSettings } from "./reviewRemoteHostsSettings.js";

function fixture(values: Record<string, unknown>) {
	const settings = new Map(Object.entries(values));
	const writes: unknown[] = [];
	const retried: string[] = [];
	const uninstalled: string[] = [];
	const hosts = reviewRemoteHostsSettings({
		get: (key) => settings.get(key),
		update: async (key, value) => {
			writes.push(value);
			settings.set(key, value);
		},
		connection: {
			listSshAliases: async () => ["devbox"],
			readRemoteHosts: async () => [{ alias: "devbox", state: "online" }],
			retryRemoteHost: async (alias) => { retried.push(alias); },
			installRemoteHost: async (alias) => { retried.push(`install ${alias}`); },
			detectRemoteAgents: async () => null,
			connectRemoteAgents: async () => [],
			uninstallRemoteHost: async (alias) => { uninstalled.push(alias); },
		},
	});
	return { hosts, writes, retried, uninstalled };
}

test("reads the two settings as main does", () => {
	const on = fixture({ [REVIEW_REMOTE_HOSTS_ENABLED_SETTING]: true, [REVIEW_REMOTE_HOSTS_SETTING]: ["devbox", 7] }).hosts;
	assert.equal(on.enabled, true);
	assert.deepEqual(on.configured, ["devbox"]);
	const off = fixture({ [REVIEW_REMOTE_HOSTS_ENABLED_SETTING]: "true", [REVIEW_REMOTE_HOSTS_SETTING]: "devbox" }).hosts;
	assert.equal(off.enabled, false);
	assert.deepEqual(off.configured, []);
});

test("refuses an alias the SSH command would refuse, with the reason, and writes nothing", async () => {
	for (const [alias, reason] of [["-bad", "starts with -"], ["a b", "contains whitespace"], ["a;b", "contains ;"], ["", "is empty"]]) {
		const { hosts, writes } = fixture({ [REVIEW_REMOTE_HOSTS_SETTING]: ["devbox"] });
		await assert.rejects(hosts.set(["devbox", alias]), { message: `The SSH alias ${JSON.stringify(alias)} ${reason}.` });
		assert.deepEqual(writes, []);
	}
});

test("writes the aliases once each and answers with the stored list", async () => {
	const { hosts, writes } = fixture({ [REVIEW_REMOTE_HOSTS_SETTING]: [] });
	assert.deepEqual(await hosts.set(["devbox", "other", "devbox"]), ["devbox", "other"]);
	assert.deepEqual(writes, [["devbox", "other"]]);
});

test("passes suggestions, states, retries, installs and uninstalls through to Desktop", async () => {
	const { hosts, retried, uninstalled } = fixture({});
	assert.deepEqual(await hosts.suggestions(), ["devbox"]);
	assert.deepEqual(await hosts.states(), [{ alias: "devbox", state: "online" }]);
	await hosts.retry("devbox");
	await hosts.install("devbox");
	assert.deepEqual(retried, ["devbox", "install devbox"]);
	await hosts.uninstall("devbox");
	assert.deepEqual(uninstalled, ["devbox"]);
});
