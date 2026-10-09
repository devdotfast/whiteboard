import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";

for (const trigger of ["SIGTERM", "SIGINT", "SIGHUP", "SIGPIPE", "EOF"] as const) {
  test(`frontend exits and cleans up on ${trigger}`, async () => {
    const child = spawn(process.execPath, ["--eval", `
      import { installShutdownHandlers } from ${JSON.stringify(new URL("./shutdown.ts", import.meta.url).href)};
      installShutdownHandlers(process.stdin, () => {
        process.stdout.write("cleaned up\\n");
        process.exit(0);
      });
      process.stdin.resume();
      setInterval(() => {}, 1000);
      process.stdout.write("ready\\n");
    `], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    const exited = once(child, "exit");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await once(child.stdout, "data");
      if (trigger === "EOF") child.stdin.end();
      else child.kill(trigger);
      expect(await exited).toEqual([0, null]);
      expect(output).toContain("cleaned up");
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
}

test("frontend cleans up when its parent is killed without a hangup", async () => {
  const frontend = `
    import { installShutdownHandlers } from ${JSON.stringify(new URL("./shutdown.ts", import.meta.url).href)};
    installShutdownHandlers(process.stdin, () => {
      process.stdout.write("cleaned up\\n");
      process.exit(0);
    });
    setInterval(() => {}, 1000);
    process.stdout.write(process.pid + "\\n");
  `;
  const parent = spawn(process.execPath, ["--eval", `
    import { spawn } from "node:child_process";
    spawn(process.execPath, ["--eval", ${JSON.stringify(frontend)}], {
      stdio: ["inherit", "inherit", "inherit"]
    });
    setInterval(() => {}, 1000);
  `], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let frontendPid: number | undefined;
  parent.stdout.on("data", data => { output += data; });
  const closed = once(parent, "close");
  const cleanup = () => {
    parent.kill("SIGKILL");
    if (frontendPid) {
      try { process.kill(frontendPid, "SIGKILL"); } catch {}
    }
  };
  const timeout = setTimeout(cleanup, 3000);
  try {
    await once(parent.stdout, "data");
    frontendPid = Number(output.trim());
    expect(frontendPid).toBeGreaterThan(1);
    parent.kill("SIGKILL");
    // close waits for the inherited stdout pipe to close in the frontend too.
    await closed;
    expect(output).toContain("cleaned up");
  } finally {
    clearTimeout(timeout);
    cleanup();
  }
});
