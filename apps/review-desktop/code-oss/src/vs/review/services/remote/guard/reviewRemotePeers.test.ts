import assert from "node:assert/strict";
import test from "node:test";
import { Event } from "../../../../base/common/event.js";
import { ICommandService } from "../../../../platform/commands/common/commands.js";
import { IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { SyncDescriptor } from "../../../../platform/instantiation/common/descriptors.js";
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { MainContext } from "../../../../workbench/api/common/extHost.protocol.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { IOutputService } from "../../../../workbench/services/output/common/output.js";
import { IStatusbarService } from "../../../../workbench/services/statusbar/browser/statusbar.js";
import { IViewsService } from "../../../../workbench/services/views/common/viewsService.js";
import { ReviewRemoteCommands, ReviewRemoteCommandService } from "./reviewRemoteCommandService.js";
import { IReviewRemoteRefusals, ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteOutputService } from "./reviewRemoteOutputService.js";
import { ReviewRemoteGuardedPeers } from "./reviewRemotePeers.js";

function scope() {
	return new InstantiationService(new ServiceCollection(
		[IReviewRemoteRefusals, new ReviewRemoteRefusals("whiteboard+aaaa-1111", () => "wb-test-a", { warn() { } } as unknown as ILogService)],
		[ICommandService, new SyncDescriptor(ReviewRemoteCommandService)],
		[IOutputService, { onActiveOutputChannel: Event.None, getActiveChannel: () => undefined }],
		[IViewsService, { isViewVisible: () => false, onDidChangeViewVisibility: Event.None }],
		[IConfigurationService, {}],
		[IStatusbarService, {}],
	), true);
}

function context(remoteAuthority: string | null) {
	const set = new Map<string, unknown>();
	const value = { remoteAuthority, getProxy: () => ({ $setVisibleChannel() { } }), set: (id: { sid: string }, instance: unknown) => set.set(id.sid, instance) };
	return { context: value as unknown as IExtHostContext, set };
}

test("a remote host's commands and output peers are the guarded ones", () => {
	const { context: remote, set } = context("whiteboard+aaaa-1111");
	scope().createInstance(ReviewRemoteGuardedPeers, remote).dispose();
	assert.ok(set.get(MainContext.MainThreadCommands.sid) instanceof ReviewRemoteCommands);
	assert.ok(set.get(MainContext.MainThreadOutputService.sid) instanceof ReviewRemoteOutputService);
});

test("the window's own extension host keeps upstream's peers", () => {
	const { context: local, set } = context(null);
	new InstantiationService(new ServiceCollection(), true).createInstance(ReviewRemoteGuardedPeers, local).dispose();
	assert.equal(set.size, 0);
});
