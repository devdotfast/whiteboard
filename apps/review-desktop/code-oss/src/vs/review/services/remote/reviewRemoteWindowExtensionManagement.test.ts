import assert from "node:assert/strict";
import test from "node:test";
import type { IChannel } from "../../../base/parts/ipc/common/ipc.js";
import type { IInstantiationService } from "../../../platform/instantiation/common/instantiation.js";
import type { ISharedProcessService } from "../../../platform/ipc/electron-browser/services.js";
import type { ILabelService } from "../../../platform/label/common/label.js";
import type { IRemoteAgentService } from "../../../workbench/services/remote/common/remoteAgentService.js";
import { ReviewExtensionManagementServerService, withoutRemoteExtensionManagement } from "./reviewRemoteWindowExtensionManagement.js";

function remote(authority: string) {
	const asked: string[] = [];
	const channel = (name: string) => ({ name, call: async () => { throw new Error(`Unknown channel: ${name}`); }, listen: () => { throw new Error(`Unknown channel: ${name}`); } });
	const connection = { remoteAuthority: authority, getChannel: (name: string) => (asked.push(name), channel(name)) };
	return { asked, service: { getConnection: () => connection } as unknown as IRemoteAgentService };
}

function serverService(remoteAgentService: IRemoteAgentService) {
	const created: unknown[][] = [];
	const instantiation = { createInstance: (...args: unknown[]) => (created.push(args), { dispose() { } }) } as unknown as IInstantiationService;
	const sharedProcess = { getChannel: (name: string) => ({ name }) } as unknown as ISharedProcessService;
	const service = new ReviewExtensionManagementServerService(sharedProcess, remoteAgentService, { getHostLabel: () => "wb-test-a" } as unknown as ILabelService, instantiation);
	return { service, remoteChannel: created[1]?.[1] as IChannel };
}

test("a whiteboard+ window manages no extensions on its server and asks it nothing", async () => {
	const { asked, service: remoteAgent } = remote("whiteboard+abc-1");
	const { service, remoteChannel } = serverService(remoteAgent);
	assert.equal(service.remoteExtensionManagementServer?.label, "wb-test-a");
	assert.deepEqual(await remoteChannel.call("getInstalled", []), []);
	assert.doesNotThrow(() => remoteChannel.listen("onDidInstallExtensions")(() => { }).dispose());
	await assert.rejects(remoteChannel.call("installFromGallery", []), /not managed from a Source window \(installFromGallery\)/);
	await withoutRemoteExtensionManagement(remoteAgent).getConnection()!.getChannel("extensionGalleryManifest").call("setExtensionGalleryManifest", [null]);
	withoutRemoteExtensionManagement(remoteAgent).getConnection()!.getChannel("remoteFilesystem");
	assert.deepEqual(asked, ["remoteFilesystem"]);
});
