import { type SpawnOptions, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type ReviewDesktopDiscovery,
  parseReviewVerbResponse,
} from "@dev.fast/review-protocol";

import {
  type ReviewInstanceSelection,
  healthyReviewInstance,
  reviewInstanceStartHint,
  reviewInstanceUnavailable,
  selectReviewInstance,
} from "./desktop-discovery";

const RELEASE_APPS = {
  stable: {
    bundleId: "dev.fast.review",
    linuxLauncher: "/usr/bin/review-desktop",
  },
  preview: {
    bundleId: "dev.fast.review.preview",
    linuxLauncher: "/usr/bin/review-preview-desktop",
  },
};

/** "1" on launches without --focus; Desktop opens inactive. */
export const REVIEW_DESKTOP_BACKGROUND_ENV =
  "DEV_FAST_REVIEW_DESKTOP_BACKGROUND";

const DEFAULT_LAUNCH_TIMEOUT_MS = 90_000;

const POLL_INTERVAL_MS = 250;

const EARLY_EXIT_GRACE_MS = 5_000;

interface DesktopLaunchProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  unref(): void;
}

interface ReviewAppLauncherRuntime {
  selectInstance: () => Promise<ReviewInstanceSelection>;
  fetch: typeof globalThis.fetch;
  focusDesktop: (discovery: ReviewDesktopDiscovery) => Promise<void>;
  launchDesktop: typeof launchDesktopApplication;
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
}

export interface RunReviewAppLaunchInput {
  timeoutMs?: number;
  /** Bring Whiteboard Desktop forward. */
  focus?: boolean;
  /** Explicit Linux container opt-out from the Chromium sandbox. */
  noSandbox?: boolean;
}

export interface ReviewAppLaunchEvent {
  event: "app";
  action: "launch";
  state: "launched" | "running";
  instanceId: string;
}

export interface DesktopLaunchAttempt {
  method: string;
  logPath?: string;
  completion: Promise<DesktopLaunchCompletion>;
}

export interface DesktopLaunchCompletion {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LaunchDesktopApplicationInput {
  platform?: NodeJS.Platform;
  execPath?: string;
  electron?: boolean;
  env?: NodeJS.ProcessEnv;
  focus?: boolean;
  noSandbox?: boolean;
  /** An explicitly selected release instance; absent, the installed app's own. */
  instance?: { key: "stable" | "preview"; appPath?: string };
  spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => DesktopLaunchProcess;
}

export async function runReviewAppLaunch(
  input: RunReviewAppLaunchInput = {},
  overrides: Partial<ReviewAppLauncherRuntime> = {},
): Promise<ReviewAppLaunchEvent> {
  const fetch = overrides.fetch ?? globalThis.fetch;

  const runtime: ReviewAppLauncherRuntime = {
    selectInstance: () => selectReviewInstance({ fetch }),
    fetch,
    focusDesktop: (discovery) => focusReviewDesktop(discovery, fetch),
    launchDesktop: launchDesktopApplication,
    now: Date.now,
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...overrides,
  };

  // Launch recovers from a stale, malformed, or incompatible record, so a
  // selection problem is not a stop here.
  const selection = await runtime.selectInstance();
  const current = healthyReviewInstance(selection);

  if (current) {
    if (input.focus) await runtime.focusDesktop(current);

    return launchEvent("running", current.instanceId);
  }

  const running = selection.instances.filter((instance) => instance.healthy);

  if (selection.key !== "stable" && selection.key !== "preview")
    throw new Error(
      `${reviewInstanceStartHint(selection)}; \`whiteboard app launch\` starts only installed apps.`,
    );

  if (selection.source === "fallback" && running.length > 1)
    throw reviewInstanceUnavailable(selection);

  const launch: LaunchDesktopApplicationInput = {
    focus: input.focus,
    noSandbox: input.noSandbox,
  };

  if (selection.source !== "fallback")
    launch.instance = {
      key: selection.key,
      appPath: selection.instance?.discovery.appPath,
    };

  const attempt = runtime.launchDesktop(launch);

  let completion: Promise<DesktopLaunchCompletion> | undefined =
    observedCompletion(attempt);

  void completion.catch(() => undefined);

  const deadline =
    runtime.now() + (input.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS);

  let unexpectedSuccessfulExitAt: number | undefined;

  while (runtime.now() < deadline) {
    const ready = healthyReviewInstance(await runtime.selectInstance());

    if (ready) return launchEvent("launched", ready.instanceId);

    if (
      unexpectedSuccessfulExitAt !== undefined &&
      runtime.now() - unexpectedSuccessfulExitAt >= EARLY_EXIT_GRACE_MS
    ) {
      throw launchFailure(
        attempt,
        new Error("the launch process exited before Desktop became ready"),
      );
    }

    const remaining = Math.max(0, deadline - runtime.now());

    const outcome = completion
      ? await Promise.race([
          completion.then((result) => ({ completion: result })),
          runtime
            .wait(Math.min(POLL_INTERVAL_MS, remaining))
            .then(() => ({ completion: null })),
        ])
      : await runtime
          .wait(Math.min(POLL_INTERVAL_MS, remaining))
          .then(() => ({ completion: null }));

    if (outcome.completion) {
      assertSuccessfulLaunchCompletion(attempt, outcome.completion);

      unexpectedSuccessfulExitAt = runtime.now();
      completion = undefined;
    }
  }

  if (unexpectedSuccessfulExitAt !== undefined) {
    throw launchFailure(
      attempt,
      new Error("the launch process exited before Desktop became ready"),
    );
  }

  throw new Error(
    `Whiteboard Desktop did not become ready within ${Math.ceil((input.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS) / 1_000)} seconds after ${attempt.method}. Open Whiteboard Desktop once, then run \`whiteboard app launch\` again.${launchDiagnostics(attempt.logPath)}`,
  );
}

export async function focusReviewDesktop(
  discovery: ReviewDesktopDiscovery,
  fetch: typeof globalThis.fetch,
): Promise<void> {
  const response = await fetch(`${discovery.url}/app/focus`, {
    method: "POST",
    headers: { "x-review-token": discovery.token },
    signal: AbortSignal.timeout(5_000),
  });

  const result = parseReviewVerbResponse(await response.json());

  if (!response.ok || !result.ok) {
    throw new Error(
      result.ok
        ? `Whiteboard Desktop focus returned ${response.status}.`
        : result.error,
    );
  }
}

export function desktopApplicationInstalled(
  input: Pick<
    LaunchDesktopApplicationInput,
    "platform" | "electron" | "env"
  > & {
    exists?: (path: string) => boolean;
  } = {},
): boolean {
  const env = input.env ?? process.env;

  if (
    (input.platform ?? process.platform) !== "linux" ||
    (input.electron ?? Boolean(process.versions.electron)) ||
    env.DEV_FAST_REVIEW_DESKTOP_COMMAND?.trim()
  )
    return true;

  return Object.values(RELEASE_APPS).some(({ linuxLauncher }) =>
    (input.exists ?? existsSync)(linuxLauncher),
  );
}

export function launchDesktopApplication(
  input: LaunchDesktopApplicationInput = {},
): DesktopLaunchAttempt {
  const platform = input.platform ?? process.platform;

  if (platform !== "darwin" && platform !== "linux") {
    return {
      method: `the ${platform} application launcher`,
      completion: Promise.reject(
        new Error("automatic launch is available only on macOS and Linux"),
      ),
    };
  }

  if (input.noSandbox && platform !== "linux")
    return {
      method: `the ${platform} application launcher`,
      completion: Promise.reject(
        new Error("--no-sandbox is only supported for Linux Desktop launches."),
      ),
    };

  const electron = input.electron ?? Boolean(process.versions.electron);
  const env = { ...(input.env ?? process.env) };
  const execPath = input.execPath ?? process.execPath;
  const focus = input.focus === true;

  if (focus) delete env[REVIEW_DESKTOP_BACKGROUND_ENV];
  else env[REVIEW_DESKTOP_BACKGROUND_ENV] = "1";

  delete env.ELECTRON_RUN_AS_NODE;

  // An installed app must never inherit a dev Desktop's identity.
  delete env.DEV_FAST_REVIEW_CHECKOUT;
  const release = RELEASE_APPS[input.instance?.key ?? "stable"];
  const stateRoot = env.DEV_FAST_REVIEW_DESKTOP_STATE_ROOT?.trim();

  const profileArgs = stateRoot
    ? [
        `--user-data-dir=${path.resolve(stateRoot, "user-data")}`,
        `--extensions-dir=${path.resolve(stateRoot, "extensions")}`,
      ]
    : [];

  let command = "/usr/bin/open";
  let method: string;
  let args: string[];

  if (platform === "linux") {
    delete env.VSCODE_DEV;
    delete env.VSCODE_CLI;
    // With no selection, the Fedora CLI wrappers name their own channel's launcher.
    command =
      (input.instance ? "" : env.DEV_FAST_REVIEW_DESKTOP_COMMAND?.trim()) ||
      release.linuxLauncher;
    method = `the installed Linux launcher at "${command}"`;

    if (electron && !env.DEV_FAST_REVIEW_DESKTOP_COMMAND?.trim()) {
      command = execPath;
      method = `the Desktop-managed bundle at "${command}"`;
    }

    args = profileArgs;

    if (input.noSandbox) args.push("--no-sandbox");
  } else {
    // Direct app execs abort in AppKit under Codex's sandbox.
    const appPath = input.instance
      ? input.instance.appPath
      : electron
        ? execPath.match(/^(.*?\.app)\/Contents\/MacOS\//)?.[1]
        : undefined;

    const target = appPath?.endsWith(".app")
      ? ["-a", appPath]
      : ["-b", release.bundleId];

    method = appPath?.endsWith(".app")
      ? `the macOS application at "${appPath}"`
      : `the macOS bundle identifier "${release.bundleId}"`;

    // -n allows parallel profiles; -W exits with Desktop, so a startup crash
    // surfaces early; --env carries Whiteboard's context.
    args = ["-n", "-W", ...(focus ? [] : ["-g"]), ...target];

    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && /^DEV_(REVIEW|FAST)_/.test(key))
        args.push("--env", `${key}=${value}`);
    }

    if (profileArgs.length > 0) args.push("--args", ...profileArgs);
  }

  const {
    promise: completion,
    resolve,
    reject,
  } = Promise.withResolvers<DesktopLaunchCompletion>();

  let logPath: string | undefined;
  let logFd: number | undefined;

  try {
    if (platform === "linux") {
      logPath = path.join(
        mkdtempSync(path.join(tmpdir(), "whiteboard-launch-")),
        "stderr.log",
      );
      logFd = openSync(logPath, "wx", 0o600);
    }

    const spawnProcess = input.spawn ?? spawn;

    const child = spawnProcess(command, args, {
      detached: true,
      env,
      stdio: logFd === undefined ? "ignore" : ["ignore", "ignore", logFd],
    });

    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
    child.unref();
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (logFd !== undefined) closeSync(logFd);
  }

  return {
    method,
    logPath,
    completion,
  };
}

function launchEvent(
  state: ReviewAppLaunchEvent["state"],
  instanceId: string,
): ReviewAppLaunchEvent {
  return { event: "app", action: "launch", state, instanceId };
}

function launchFailure(attempt: DesktopLaunchAttempt, error: Error): Error {
  return new Error(
    `Could not launch Whiteboard with ${attempt.method}: ${error.message}. Open Whiteboard once, then run \`whiteboard app launch\` again. A sandboxed agent must run it outside the sandbox.${launchDiagnostics(attempt.logPath)}`,
  );
}

function assertSuccessfulLaunchCompletion(
  attempt: DesktopLaunchAttempt,
  completion: DesktopLaunchCompletion,
): void {
  if (completion.code === 0 && !completion.signal) return;
  throw launchFailure(
    attempt,
    new Error(
      completion.signal
        ? `the launch process exited on ${completion.signal}`
        : `the launch process exited with code ${completion.code ?? "unknown"}`,
    ),
  );
}

function observedCompletion(
  attempt: DesktopLaunchAttempt,
): Promise<DesktopLaunchCompletion> {
  return attempt.completion.catch((error) => {
    throw launchFailure(
      attempt,
      error instanceof Error ? error : new Error(String(error)),
    );
  });
}

function launchDiagnostics(logPath: string | undefined): string {
  if (!logPath) return "";
  let tail = "";

  try {
    const fd = openSync(logPath, "r");

    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 16_384));
      const read = readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      tail = buffer
        .subarray(0, read)
        .toString("utf8")
        .trim()
        .split("\n")
        .slice(-20)
        .join("\n");
    } finally {
      closeSync(fd);
    }
  } catch {
    // A missing log must not hide the launch failure.
  }

  return `\nDesktop log: ${logPath}${tail ? `\n${tail}` : ""}`;
}
