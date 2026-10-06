// Every git, jj and gh process goes through these three wrappers. They are
// where the rules for running version control live, once:
//
//   - nothing waits on a prompt (GIT_TERMINAL_PROMPT=0, GH_PROMPT_DISABLED);
//   - a partial clone never fetches a missing object as a side effect of a
//     read (GIT_NO_LAZY_FETCH=1; a fetch or clone still fetches);
//   - every call has a timeout unless the caller sets its own: 30 seconds
//     for a quick query, 5 minutes for a read that can be large or a jj
//     call (which may first rebuild a cold index), 10 minutes for a fetch;
//   - a value that didn't come from the code (a commit, ref, path, remote,
//     anything read from a board, a share or GitHub) is passed as an
//     `Operand`: it is checked before anything runs, can never be read as
//     an option, and paths go after `--`.
//
// A host (the Review CLI's startup tracer) can also observe each spawn
// without this package depending on any tracing library.
import {
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  type ExecFileOptions,
  type ExecFileSyncOptions,
  type SpawnOptionsWithStdioTuple,
  type StdioPipe,
  execFile,
  execFileSync,
  spawn,
} from "node:child_process";
import type { Socket } from "node:net";
import { promisify } from "node:util";

/** A value from outside the code, given to git, jj or gh as an operand. */
export type Operand =
  /** A full commit id. */
  | { commit: string }
  /** A revision expression: a commit, ref, `HEAD~1`, `a..b`. */
  | { rev: string }
  /** A ref or branch name. */
  | { ref: string }
  /** `[+]<from>:<to>`, each a commit id or ref. */
  | { refspec: { from: string; to: string; force?: boolean } }
  /** A path in a checkout; always after `--`. */
  | { path: string }
  /** A remote's name or URL. */
  | { remote: string }
  /** Any other value: a message, a search, a PR number. */
  | { value: string };

/** An argument: a flag or subcommand written in the code, or an operand. */
export type VcsArg = string | Operand;

/** The programs this runner runs. */
export type VcsTool = "git" | "jj" | "gh";

/** A quick query: a ref, a config value, a status. */
const QUICK_TIMEOUT_MS = 30_000;

/** A read that grows with the repository or a file in it, or a jj call. */
const LARGE_READ_TIMEOUT_MS = 5 * 60_000;

/** Talking to a remote. */
const NETWORK_TIMEOUT_MS = 10 * 60_000;

const NETWORK_COMMANDS = new Set(["fetch", "clone", "pull", "push"]);

const LARGE_READS = new Set([
  "archive",
  "blame",
  "cat-file",
  "diff",
  "diff-tree",
  "format-patch",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "rev-list",
  "show",
]);

/** The subcommand, past git's global options and their values. */
function subcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (["-C", "-c", "--git-dir", "--work-tree", "-R"].includes(arg)) i++;
    else if (!arg.startsWith("-")) return arg;
  }

  return undefined;
}

/** How long a call may run when its caller doesn't say. */
export function defaultVcsTimeout(
  tool: VcsTool,
  args: readonly string[],
): number {
  const command = subcommand(args);

  if (command && NETWORK_COMMANDS.has(command)) return NETWORK_TIMEOUT_MS;

  if (tool === "jj" || (command && LARGE_READS.has(command)))
    return LARGE_READ_TIMEOUT_MS;

  return QUICK_TIMEOUT_MS;
}

const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Thrown before anything runs when an operand could be misread. */
export class VcsOperandError extends Error {}

function refused(kind: string, value: string): never {
  throw new VcsOperandError(`Refusing ${kind} ${JSON.stringify(value)}.`);
}

/** Whether a value could be read as an option, or carries a control
 * character or a line break. */
const unsafe = (value: string) =>
  !value || value.startsWith("-") || /[\0-\x1f\x7f]/.test(value);

const unsafeRef = (value: string) =>
  unsafe(value) || /[\s:~^?*[\\]|\.\.|@\{/.test(value);

function checkRefSide(value: string) {
  if (!COMMIT_ID.test(value) && unsafeRef(value)) refused("ref", value);
}

/** Operands are objects; flags written in the code are strings. */
const isOperand = (arg: VcsArg): arg is Operand => Object(arg) === arg;

/** The arguments as the process gets them: operands checked, so none can
 * be read as an option, and paths after `--`. (`--end-of-options` would say
 * the same to git, but older gits refuse it in some commands.) */
export function renderVcsArgs(args: readonly VcsArg[]): string[] {
  const out: string[] = [];
  let paths = false;

  for (const arg of args) {
    if (!isOperand(arg)) {
      if (arg === "--") paths = true;
      out.push(arg);
      continue;
    }

    if ("path" in arg) {
      if (!arg.path || /\0/.test(arg.path)) refused("path", arg.path);

      if (!paths) {
        out.push("--");
        paths = true;
      }

      out.push(arg.path);
      continue;
    }

    let rendered: string;

    if ("commit" in arg) {
      if (!COMMIT_ID.test(arg.commit)) refused("commit", arg.commit);
      rendered = arg.commit;
    } else if ("rev" in arg) {
      if (unsafe(arg.rev)) refused("revision", arg.rev);
      rendered = arg.rev;
    } else if ("ref" in arg) {
      if (unsafeRef(arg.ref)) refused("ref", arg.ref);
      rendered = arg.ref;
    } else if ("refspec" in arg) {
      checkRefSide(arg.refspec.from);
      checkRefSide(arg.refspec.to);
      rendered = `${arg.refspec.force ? "+" : ""}${arg.refspec.from}:${arg.refspec.to}`;
    } else if ("remote" in arg) {
      if (unsafe(arg.remote) || /\s/.test(arg.remote))
        refused("remote", arg.remote);
      rendered = arg.remote;
    } else {
      if (unsafe(arg.value)) refused("value", arg.value);
      rendered = arg.value;
    }

    out.push(rendered);
  }

  return out;
}

const LOCAL_GIT_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
] as const;

/** The process environment without the variables that would redirect git
 * to another repository's objects, index or work tree. */
export function localGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  for (const key of LOCAL_GIT_ENV_KEYS) delete env[key];

  return env;
}

/** The environment a version-control process runs with. A git call that
 * names its repository (`-C`, `--git-dir`) and brings no environment of its
 * own drops the variables that would redirect it to another. */
function vcsEnvironment(
  tool: VcsTool,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  const next: NodeJS.ProcessEnv = {
    ...(env ??
      (tool === "git" && (args[0] === "-C" || args[0] === "--git-dir")
        ? localGitEnvironment()
        : process.env)),
  };

  const fetching = args.some((arg) =>
    ["fetch", "clone", "pull", "push"].includes(arg),
  );

  if (!fetching) next.GIT_NO_LAZY_FETCH = "1";
  next.GIT_TERMINAL_PROMPT = "0";
  next.GH_PROMPT_DISABLED = "1";

  return next;
}

export interface LocalVcsCommandObserver {
  /** Called before the process spawns. Returns a completion callback. */
  start(input: {
    tool: VcsTool;
    args: string[];
    cwd: string | undefined;
  }): (outcome: { ok: boolean }) => void;
}

let observer: LocalVcsCommandObserver | null = null;

export function setLocalVcsCommandObserver(
  next: LocalVcsCommandObserver | null,
): void {
  observer = next;
}

const execFilePromise = promisify(execFile);

export async function runVcs(
  tool: VcsTool,
  vcsArgs: readonly VcsArg[],
  {
    input,
    ...options
  }: ExecFileOptions & {
    encoding?: "utf8" | BufferEncoding;
    /** Written to the command's stdin, which then closes. */
    input?: string;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const args = renderVcsArgs(vcsArgs);

  const finish = observer?.start({
    tool,
    args,
    cwd: options.cwd === undefined ? undefined : String(options.cwd),
  });

  try {
    const running = execFilePromise(tool, args, {
      ...options,
      env: vcsEnvironment(tool, args, options.env),
      timeout: options.timeout ?? defaultVcsTimeout(tool, args),
      encoding: options.encoding ?? "utf8",
    });

    if (input !== undefined) {
      // A command that exits before reading it all closes the pipe early.
      running.child.stdin?.on("error", () => {});
      running.child.stdin?.end(input);
    }

    const result = await running;

    finish?.({ ok: true });

    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    finish?.({ ok: false });
    throw error;
  }
}

export function runVcsSync(
  tool: VcsTool,
  vcsArgs: readonly VcsArg[],
  options: ExecFileSyncOptions,
): string {
  const args = renderVcsArgs(vcsArgs);

  const finish = observer?.start({
    tool,
    args,
    cwd: options.cwd === undefined ? undefined : String(options.cwd),
  });

  try {
    const output = execFileSync(tool, args, {
      ...options,
      env: vcsEnvironment(tool, args, options.env),
      timeout: options.timeout ?? defaultVcsTimeout(tool, args),
    });

    finish?.({ ok: true });

    return String(output);
  } catch (error) {
    finish?.({ ok: false });
    throw error;
  }
}

/** A child with all three streams piped, under the same rules, for a
 * caller that streams input and output itself. Its timeout is the caller's
 * to enforce. */
export function spawnPiped(
  tool: VcsTool,
  vcsArgs: readonly VcsArg[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcessWithoutNullStreams {
  const args = renderVcsArgs(vcsArgs);

  const finish = observer?.start({ tool, args, cwd: options.cwd });

  const child = spawn(tool, args, {
    cwd: options.cwd,
    env: vcsEnvironment(tool, args, options.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.once("spawn", () => finish?.({ ok: true }));
  child.once("error", () => finish?.({ ok: false }));

  return child;
}

/** Long-lived child; the observer sees one spawn, completed once the process is up. */
export function spawnObserved(
  tool: VcsTool,
  vcsArgs: readonly VcsArg[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, "ignore">,
): ChildProcessByStdio<Socket, Socket, null> {
  const args = renderVcsArgs(vcsArgs);

  const finish = observer?.start({
    tool,
    args,
    cwd: options.cwd === undefined ? undefined : String(options.cwd),
  });

  try {
    // SAFETY: piped stdin/stdout are net.Sockets.
    const child = spawn(tool, args, {
      ...options,
      env: vcsEnvironment(tool, args, options.env),
    }) as ChildProcessByStdio<Socket, Socket, null>;

    let finished = false;

    const complete = (ok: boolean) => {
      if (finished) return;
      finished = true;
      finish?.({ ok });
    };

    child.once("spawn", () => complete(true));
    child.once("error", () => complete(false));

    return child;
  } catch (error) {
    finish?.({ ok: false });

    throw error;
  }
}
