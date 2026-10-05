/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { connect } from "node:net";
import { REVIEW_SSH_ASKPASS_ALIAS_ENV, REVIEW_SSH_ASKPASS_SOCKET_ENV } from "../common/reviewSshPrompt.js";

const TIMEOUT_MS = 10 * 60_000;

const socketPath = process.env[REVIEW_SSH_ASKPASS_SOCKET_ENV];
const alias = process.env[REVIEW_SSH_ASKPASS_ALIAS_ENV];
if (!socketPath || !alias) process.exit(1);

process.exitCode = 1;
const fail = () => process.exit(1);

const socket = connect(socketPath);
socket.setEncoding("utf8");
socket.setTimeout(TIMEOUT_MS, fail);
socket.on("error", fail);
socket.on("connect", () => socket.write(`${JSON.stringify({ alias, text: process.argv[2] ?? "", pid: process.ppid })}\n`));
let reply = "";
socket.on("data", (chunk: string) => (reply += chunk));
socket.on("end", () => {
	let answer: unknown;
	try {
		answer = (JSON.parse(reply) as { answer?: unknown }).answer;
	} catch {
		fail();
	}
	if (typeof answer !== "string") fail();
	else process.stdout.write(answer, () => (process.exitCode = 0));
});
