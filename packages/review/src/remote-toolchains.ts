import { spawn } from "node:child_process";
import path from "node:path";

const PROBE_TIMEOUT_MS = 10_000;

type Toolchains = Record<string, readonly (readonly string[])[]>;

const TOOLCHAINS = {
  rust: [
    ["cargo", "--version"],
    ["rustc", "--version"],
  ],
  swift: [["swift", "--version"]],
  csharp: [["dotnet", "--version"]],
  go: [["go", "version"]],
} satisfies Toolchains;

type Outcome = "found" | "missing" | string;

function probe(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  const shell = env.SHELL || "/bin/sh";

  const flags = ["csh", "tcsh"].includes(path.basename(shell))
    ? ["-ic"]
    : ["-i", "-l", "-c"];

  return new Promise<Outcome>((resolve) => {
    const child = spawn(shell, [...flags, command.join(" ")], {
      env,
      detached: true,
      stdio: "ignore",
    });

    const timer = setTimeout(() => {
      child.removeAllListeners("exit");

      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}

      resolve(
        `${command.join(" ")} did not answer within ${timeoutMs / 1_000} s`,
      );
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(`the login shell ${shell} did not run: ${error.message}`);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? "found"
          : code === 127
            ? "missing"
            : `${command.join(" ")} failed with exit code ${code ?? "none"}`,
      );
    });
  });
}

export async function missingToolchains(
  groups: readonly string[],
  env: NodeJS.ProcessEnv,
  {
    timeoutMs = PROBE_TIMEOUT_MS,
    toolchains = TOOLCHAINS,
  }: { timeoutMs?: number; toolchains?: Toolchains } = {},
) {
  const entries = await Promise.all(
    groups.map(async (group) => {
      const commands = Object.hasOwn(toolchains, group)
        ? toolchains[group]
        : [];

      const outcomes = await Promise.all(
        commands.map((command) => probe(command, env, timeoutMs)),
      );

      const missing = commands
        .filter((_, i) => outcomes[i] === "missing")
        .map(([tool]) => tool);

      const failures = outcomes.filter(
        (outcome) => outcome !== "found" && outcome !== "missing",
      );

      const details = [
        ...(missing.length > 0
          ? [
              `${missing.join(" and ")} ${missing.length > 1 ? "were" : "was"} not found on the login shell's PATH`,
            ]
          : []),
        ...failures,
      ];

      return details.length > 0 ? [[group, details.join("; ")] as const] : [];
    }),
  );

  return new Map(entries.flat());
}
