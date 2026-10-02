/** Child-process helpers shared by the remote.mjs modules. */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

export const exec = promisify(execFile);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(command, args, options = {}) {
  const { stdout } = await exec(command, args, {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

  return stdout.trim();
}

export const docker = (...args) => run("docker", args);

export const aws = async (...args) =>
  JSON.parse((await run("aws", [...args, "--output", "json"])) || "null");

/** Runs a command on this terminal; resolves to its exit code. */
export const inherit = (command, args) =>
  new Promise((resolve) =>
    spawn(command, args, { stdio: "inherit" }).once("exit", (code) =>
      resolve(code ?? 1),
    ),
  );

export const addOnce = (list, item) => list.includes(item) || list.push(item);
