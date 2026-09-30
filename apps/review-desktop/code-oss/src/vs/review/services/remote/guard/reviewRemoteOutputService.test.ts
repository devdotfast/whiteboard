import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { Event } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { Registry } from "../../../../platform/registry/common/platform.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { Extensions, type IOutputChannelRegistry, type IOutputService } from "../../../../workbench/services/output/common/output.js";
import type { IStatusbarService } from "../../../../workbench/services/statusbar/browser/statusbar.js";
import type { IViewsService } from "../../../../workbench/services/views/common/viewsService.js";
import { ReviewRemoteOutputService } from "./reviewRemoteOutputService.js";

function setup() {
	const { warnings, refusals: r } = refusals();
	const context = { getProxy: () => ({ $setVisibleChannel() { } }) } as unknown as IExtHostContext;
	const output = { onActiveOutputChannel: Event.None, getActiveChannel: () => undefined, getChannel: () => undefined } as unknown as IOutputService;
	const views = { isViewVisible: () => false, onDidChangeViewVisibility: Event.None } as unknown as IViewsService;
	const service = new ReviewRemoteOutputService(context, output, views, {} as IConfigurationService, {} as IStatusbarService, r);
	return { service, warnings };
}

const channels = () => Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).getChannels().map((channel) => channel.id);

test("an output channel on the host's own file is registered", async () => {
	const { service } = setup();
	const id = await service.$register("Probe", URI.parse(`vscode-remote://${A}/tmp/probe.log`), undefined, "wb-test.probe");
	assert.ok(channels().includes(id));
	Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).removeChannel(id);
	service.dispose();
});

test("an output channel on a laptop or another host's file is refused, logged once", async () => {
	const { service, warnings } = setup();
	const before = channels();
	for (const file of [URI.file("/etc/hosts"), URI.parse("vscode-remote://whiteboard+bbbb-2222/tmp/x.log")]) {
		await assert.rejects(service.$register("Probe", file, undefined, "wb-test.probe"), /^Error: Not available for an extension on wb-test-a: output channels on files outside this remote\.$/);
	}
	assert.deepEqual(channels(), before);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused output channels on files outside this remote`]);
	service.dispose();
});
