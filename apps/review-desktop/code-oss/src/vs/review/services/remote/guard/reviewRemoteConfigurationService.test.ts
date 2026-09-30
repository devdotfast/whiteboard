import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../../base/common/event.js";
import { ConfigurationTarget, type IConfigurationChangeEvent, type IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { Extensions, type IConfigurationNode, type IConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.js";
import { ExtensionIdentifier, type IExtensionDescription } from "../../../../platform/extensions/common/extensions.js";
import { NullLogService, type ILogService } from "../../../../platform/log/common/log.js";
import { Registry } from "../../../../platform/registry/common/platform.js";
import { reviewRemoteConfigurationService } from "./reviewRemoteConfigurationService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const refused = /^Error: Not available for an extension on wb-test-a: /;

const user: Record<string, unknown> = {
	"workbench.colorTheme": "Review Dark",
	"review.remote.hosts": ["laptop-only"],
	"laptopext.token": "secret",
	"typescript.tsdk": "/Users/me/ts/lib",
	"typescript.format.enable": false,
	"evil.own": 1,
};

function extension(id: string, properties: Record<string, object>): IExtensionDescription {
	return { identifier: new ExtensionIdentifier(id), contributes: { configuration: { properties } } } as unknown as IExtensionDescription;
}

function setup(t: { after(fn: () => void): void }) {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	const nodes: IConfigurationNode[] = [
		{ id: "core", properties: { "review.remote.hosts": { type: "array", default: [] } } },
		{ id: "laptopext", properties: { "laptopext.token": { type: "string", default: "" } }, extensionInfo: { id: "dev.laptopext" } },
		{ id: "ts", properties: { "typescript.tsdk": { type: "string", default: "" } }, extensionInfo: { id: "vscode.typescript-language-features" } },
	];
	for (const node of nodes) registry.registerConfiguration(node);
	t.after(() => registry.deregisterConfigurations(nodes));

	const warnings: string[] = [];
	const changed = new Emitter<IConfigurationChangeEvent>();
	const writes: unknown[] = [];
	const base = {
		getConfigurationData: () => ({
			defaults: { contents: { workbench: { colorTheme: "Default Dark" } }, keys: ["workbench.colorTheme"], overrides: [] },
			userLocal: { contents: user, keys: Object.keys(user), overrides: [] },
		}),
		inspect: (key: string) => ({ userLocalValue: user[key] }),
		onDidChangeConfiguration: changed.event,
		updateValue: async (...args: unknown[]) => writes.push(args),
	} as unknown as IConfigurationService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const configuration = reviewRemoteConfigurationService(base, [
		extension("vscode.typescript-language-features", { "typescript.tsdk": { type: "string" }, "typescript.format.enable": { type: "boolean", default: true } }),
		extension("evil.ext", { "review.remote.hosts": {}, "laptopext.token": {}, "evil.own": { default: 0 } }),
	], refusals, new NullLogService());
	return { configuration, changed, writes, warnings };
}

test("a host gets the defaults and the user's values for its extensions' own keys only", (t) => {
	const { configuration } = setup(t);
	const data = JSON.parse(JSON.stringify(configuration.getConfigurationData()));
	assert.deepEqual(data.userLocal.contents, { typescript: { tsdk: "/Users/me/ts/lib", format: { enable: false } }, evil: { own: 1 } });
	assert.deepEqual(data.defaults.contents, { workbench: { colorTheme: "Default Dark" }, typescript: { format: { enable: true } }, evil: { own: 0 } });
	for (const model of [data.policy, data.application, data.userRemote, data.workspace]) assert.deepEqual(model, { contents: {}, keys: [], overrides: [] });
	assert.deepEqual(data.folders, []);
});

test("writes are refused, logged once", async (t) => {
	const { configuration, writes, warnings } = setup(t);
	await assert.rejects(configuration.updateValue("editor.fontSize", 30, ConfigurationTarget.USER), refused);
	await assert.rejects(configuration.updateValue("evil.own", 2), refused);
	assert.deepEqual(writes, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing settings`]);
});

test("a change reaches the host only for its own keys", (t) => {
	const { configuration, changed } = setup(t);
	const seen: unknown[] = [];
	const listener = configuration.onDidChangeConfiguration((e) => seen.push(e.change));
	const fire = (keys: string[]) => changed.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set(keys), change: { keys, overrides: [] }, affectsConfiguration: () => false });
	fire(["workbench.colorTheme"]);
	fire(["laptopext.token", "typescript.tsdk"]);
	listener.dispose();
	assert.deepEqual(seen, [{ keys: ["typescript.tsdk"], overrides: [] }]);
});
