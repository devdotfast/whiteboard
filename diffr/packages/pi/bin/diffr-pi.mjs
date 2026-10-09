#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const child = spawn("pi", ["--tui-mode", "fullscreen", "-e", fileURLToPath(new URL("../dist/index.js", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
