import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import type { IConfigurationChangeEvent, IConfigurationModel, IConfigurationService } from "../../../platform/configuration/common/configuration.js";
import { Configuration } from "../../../platform/configuration/common/configurationModels.js";
import { NullLogService } from "../../../platform/log/common/log.js";
import { Workspace, WorkspaceFolder, type IWorkspaceContextService } from "../../../platform/workspace/common/workspace.js";
import { reviewSourceWindowDefaults } from "../../common/reviewConfigurationDefaults.js";
import { reviewSourceWindowConfiguration } from "./reviewSourceWindowConfiguration.js";

const log = new NullLogService();
const root = URI.file("/checkout");
const file = URI.file("/checkout/src/a.ts");

function model(contents: Record<string, unknown>): IConfigurationModel {
	const keys: string[] = [];
	const walk = (value: Record<string, unknown>, prefix: string) => {
		for (const [key, child] of Object.entries(value)) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (["files", "window"].includes(path) && child && typeof child === "object") walk(child as Record<string, unknown>, path);
			else keys.push(path);
		}
	};
	walk(contents, "");
	return { contents, keys, overrides: [] };
}

function window() {
	const [include, value] = Object.entries(reviewSourceWindowDefaults["files.readonlyInclude"])[0];
	const empty = model({});
	const data = {
		// A host extension's configurationDefaults merge into the fork's, key by key.
		defaults: model({ files: { readonlyInclude: { [include]: !value, "**/*.md": true }, readonlyExclude: { "**/*": true } }, window: { title: "${rootName}" } }),
		policy: empty,
		application: empty,
		userLocal: empty,
		userRemote: model({ files: { readonlyExclude: { "**/*": true } } }),
		workspace: model({ files: { readonlyInclude: { [include]: false }, readonlyExclude: { "**/*": true } }, window: { title: "x" } }),
		// The checkout's .vscode/settings.json.
		folders: [[root, { contents: { files: { readonlyInclude: { [include]: false }, readonlyExclude: { "src/**": true } } }, keys: ["files.readonlyInclude", "files.readonlyExclude"], overrides: [] }]] as [URI, IConfigurationModel][],
	};
	const workspace = new Workspace("w", [new WorkspaceFolder({ uri: root, name: "repo", index: 0 })], false, URI.file("/reviews/navigator/workspaces/worktree/repo.code-workspace"), () => false);
	const configuration = Configuration.parse(data, log);
	const changed = new Emitter<IConfigurationChangeEvent>();
	const base = {
		getConfigurationData: () => configuration.toData(),
		getValue: (section?: unknown, overrides?: unknown) => configuration.getValue(typeof section === "string" ? section : undefined, (typeof section === "string" ? overrides : section) as object ?? {}, workspace),
		inspect: (key: string, overrides = {}) => configuration.inspect(key, overrides, workspace),
		getWorkspace: () => workspace,
		onDidChangeConfiguration: changed.event,
	} as unknown as IConfigurationService & IWorkspaceContextService;
	return reviewSourceWindowConfiguration(base, log);
}

test("a Source window's extension defaults, workspace file, its checkout's .vscode/settings.json and the host's settings cannot lower read-only, and its title is the fork's", () => {
	const { service, setTitle } = window();
	assert.deepEqual(service.getValue("files.readonlyInclude", { resource: file }), { "**/*": true });
	assert.deepEqual(service.getValue("files.readonlyExclude", { resource: file }), {});
	assert.deepEqual(service.getValue<{ files: object }>({ resource: file }).files, { readonlyInclude: { "**/*": true }, readonlyExclude: {} });
	assert.equal(service.inspect("files.readonlyInclude", { resource: file }).workspaceFolderValue, undefined);
	assert.equal(service.inspect("files.readonlyExclude", { resource: file }).workspaceFolderValue, undefined);
	assert.equal(service.getValue("window.title"), "x");

	const events: IConfigurationChangeEvent[] = [];
	service.onDidChangeConfiguration((e) => events.push(e));
	setTitle({ side: "live", title: "Fix the parser" });
	assert.equal(service.getValue("window.title"), "Fix the parser — Live source — Whiteboard");
	assert.equal(events.length, 1);
	assert.ok(events[0].affectsConfiguration("window.title"));
	setTitle({ side: "base", title: "Fix the parser" });
	assert.equal(service.getValue<{ window: { title: string } }>().window.title, "Fix the parser — Base source — Whiteboard");
	assert.equal(service.inspect("window.title").value, "Fix the parser — Base source — Whiteboard");
});
