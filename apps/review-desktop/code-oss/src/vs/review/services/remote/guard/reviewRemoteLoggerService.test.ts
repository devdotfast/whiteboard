import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import { type ILoggerService, LogLevel } from "../../../../platform/log/common/log.js";
import { ReviewRemoteLoggerService } from "./reviewRemoteLoggerService.js";

const own = URI.parse(`vscode-remote://${A}/home/dev/.dev/whiteboard-remote/server/data/logs/exthost1/probe.log`);

function setup() {
	const { warnings, refusals: r } = refusals();
	const levels = new Emitter<LogLevel | [URI, LogLevel]>();
	const touched: string[] = [];
	const base = {
		getLogLevel: () => LogLevel.Debug,
		onDidChangeLogLevel: levels.event,
		createLogger: () => touched.push("createLogger"),
		registerLogger: () => touched.push("registerLogger"),
	} as unknown as ILoggerService;
	return { loggers: new ReviewRemoteLoggerService(base, r), warnings, levels, touched };
}

test("a host's own log files are known by name only; the window writes nothing for them", () => {
	const { loggers, touched } = setup();
	const logger = loggers.createLogger(own);
	logger.info("hello");
	assert.equal(loggers.getLogger(own), logger);
	loggers.registerLogger({ resource: own, id: "probe" });
	assert.deepEqual([...loggers.getRegisteredLoggers()].map((l) => l.id), ["probe"]);
	assert.equal(loggers.getLogLevel(), LogLevel.Debug);
	assert.deepEqual(touched, []);
});

test("laptop, profile and other hosts' log files and ids are refused, logged once", () => {
	const { loggers, warnings, touched } = setup();
	for (const target of [URI.file("/Users/me/.zshrc"), URI.parse("vscode-remote://whiteboard+bbbb-2222/tmp/x.log"), "rendererLog"]) {
		assert.throws(() => loggers.createLogger(target as URI), /^Error: Not available for an extension on wb-test-a: logging to files outside this remote\.$/);
	}
	assert.throws(() => loggers.registerLogger({ resource: URI.file("/Users/me/Library/Logs/x.log"), id: "x" }), /logging to files outside this remote/);
	assert.deepEqual([...loggers.getRegisteredLoggers()], []);
	assert.deepEqual(touched, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused logging to files outside this remote`]);
});

test("level changes pass on without the laptop's log file names", () => {
	const { loggers, levels } = setup();
	const seen: unknown[] = [];
	loggers.onDidChangeLogLevel((level) => seen.push(level));
	levels.fire([URI.file("/Users/me/Library/Logs/window1/renderer.log"), LogLevel.Trace]);
	levels.fire(LogLevel.Warning);
	assert.deepEqual(seen, [LogLevel.Warning]);
});
