import assert from "node:assert/strict";
import { test } from "node:test";
import { Schemas } from "../../../base/common/network.js";
import { OperatingSystem } from "../../../base/common/platform.js";
import { extUri } from "../../../base/common/resources.js";
import { URI } from "../../../base/common/uri.js";
import { getResourceToLoad } from "../../../workbench/contrib/webview/browser/resourceLoading.js";
import { reviewRemoteOS, setReviewRemoteOS } from "./reviewRemoteAuthority.js";

const AUTHORITY = "whiteboard+3480c31a";
const remote = (path: string) => URI.from({ scheme: Schemas.vscodeRemote, authority: AUTHORITY, path });
const load = (path: string, root: string) => {
	const request = remote(path);
	return getResourceToLoad(request, [remote(root)], { extUri } as never, reviewRemoteOS(request));
};

test("Home loads a connected host's webview resources by authority", (t) => {
	const host = setReviewRemoteOS(AUTHORITY, OperatingSystem.Linux);
	t.after(() => host.dispose());
	assert.ok(load("/home/me/ext/media/a.js", "/home/me/ext"));
	assert.equal(reviewRemoteOS(remote("/a").with({ authority: "Whiteboard+3480C31A" })), OperatingSystem.Linux);
});

test("a host that is not connected loads nothing", () => {
	assert.equal(load("/home/me/ext/media/a.js", "/home/me/ext"), undefined);
});
