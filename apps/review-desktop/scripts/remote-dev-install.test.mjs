import assert from "node:assert/strict";
import test from "node:test";

import { installedFrom } from "./remote-dev-install.mjs";

test("installedFrom reads the version directory off the DONE line, wherever the root is", () => {
	const said = `WHITEBOARD-INSTALL STEP package\n.\n.\nWHITEBOARD-INSTALL DONE {"version":"1.2.3","sha256":"ab","node":"/srv/x/whiteboard-remote/versions/1.2.3/bin/node","cli":"/srv/x/whiteboard-remote/versions/1.2.3/dist/cli.js","installedAt":1}\n`;
	assert.equal(installedFrom(said), "/srv/x/whiteboard-remote/versions/1.2.3");
	assert.equal(installedFrom("WHITEBOARD-INSTALL FAIL cannot unpack the tarball\n"), undefined);
});
