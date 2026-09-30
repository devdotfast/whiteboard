import assert from "node:assert/strict";
import test from "node:test";
import { type ITelemetryService, TelemetryLevel } from "../../../../platform/telemetry/common/telemetry.js";
import { reviewRemoteTelemetryService } from "./reviewRemoteTelemetryService.js";

test("a host gets the user's level but not the laptop's ids, and its events are dropped", () => {
	const sent: string[] = [];
	const window = {
		telemetryLevel: TelemetryLevel.ERROR,
		sessionId: "laptop-session",
		machineId: "laptop-machine",
		sqmId: "laptop-sqm",
		devDeviceId: "laptop-device",
		firstSessionDate: "2026-01-01",
		publicLog: (name: string) => sent.push(name),
	} as unknown as ITelemetryService;
	const telemetry = reviewRemoteTelemetryService(window);
	assert.equal(telemetry.telemetryLevel, TelemetryLevel.ERROR);
	const ids = [telemetry.sessionId, telemetry.machineId, telemetry.sqmId, telemetry.devDeviceId, telemetry.firstSessionDate].join(" ");
	assert.doesNotMatch(ids, /laptop|2026-01-01/);
	telemetry.publicLog("probe.event");
	telemetry.publicLog2("probe.event");
	assert.deepEqual(sent, []);
});
