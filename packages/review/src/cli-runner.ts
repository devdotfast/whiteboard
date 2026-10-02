import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  StoreApiError,
  processIsAlive,
  readStoreAuth,
  withStoreAuthorization,
} from "@dev.fast/trace-core";
import {
  type CliInputStream,
  DEFAULT_STORE_ORIGIN,
  DEV_REVIEW_HOME_ENV,
  emitJsonEvent,
  humanStream,
  jsonRequestedInArgv,
  registerTraceCommands,
  resolveTraceCommand,
  runStoreLogin,
  runStoreLogout,
  runStoreWhoami,
  runTraceAllow,
  runTraceDeny,
  runTraceInstallMachine,
  runTraceOnboard,
  runTraceSessions,
  runTraceStoreDelete,
  runTraceStoreInfo,
  traceHomeDir,
  traceMachineEnabled,
  traceScope,
} from "@dev.fast/trace-core";
import { Argument, Command, CommanderError, Option } from "commander";

import {
  isOwnedShim,
  pathShimPath,
  windowsInstallerCommand,
} from "./cli-install";
import { cliRuntimeInfo, describeCliRuntime } from "./cli-runtime-info";
import {
  AGENT_CONNECT_TARGETS,
  type AgentConnectTarget,
  connectAgents,
  detectAgents,
} from "./connect-agents";
import { connectPrompts } from "./connect-prompts";
import { readReviewInstances, selectReviewInstance } from "./desktop-discovery";
import {
  ALL_INSTALL_TARGETS,
  type InstallTarget,
  isInstallTarget,
} from "./install";
import { scanLegacySkills } from "./legacy-skills";
import { runReviewMigration } from "./migrate";
import {
  findReviewPackageRoot,
  readReviewPackageVersion,
} from "./package-paths";
import { reviewAgentCliHelp } from "./review-api/agent-cli";
import { type ReviewAppEvent, runReviewAppPick } from "./review-app";
import {
  type ReviewAppLaunchEvent,
  runReviewAppLaunch,
} from "./review-app-launcher";
import { runReviewInfo } from "./review-info";
import {
  clearReviewInstance,
  listReviewInstancesCommand,
  useReviewInstance,
} from "./review-instances";
import { emitReviewEvent, serializeReviewError } from "./review-logger";
import {
  type ReviewCliCommand,
  type ReviewCliCommandPath,
  type ReviewCommandTelemetry,
  ReviewTelemetry,
  type ReviewTelemetryErrorCategory,
  type ReviewTelemetryErrorName,
} from "./review-telemetry";
import {
  type ReviewServerDiscovery,
  readReviewServerDiscovery,
  readReviewServerHealth,
  reviewServerIsHealthy,
  reviewServerStateDir,
  serverNotReady,
} from "./server-discovery";
import { aliasInstallationToAccount } from "./server/account-alias";
import { setTraceAttribute, span } from "./startup-trace";
import type { ReviewTelemetrySurface } from "./telemetry-config";
import {
  runTraceBlame,
  runTraceDisable,
  runTraceEnable,
  runTraceGitHook,
  runTraceHook,
  runTraceList,
  runTracePull,
  runTraceRepair,
  runTraceShow,
  runTraceStatus,
  runTraceSync,
} from "./trace-cli";
import { runTraceConfigMigrate, runTraceStorageUse } from "./trace-storage-cli";

interface ReviewCliRuntime {
  runReviewAppLaunch: typeof runReviewAppLaunch;
  runReviewAppPick: typeof runReviewAppPick;
  runReviewInfo: typeof runReviewInfo;
  runReviewMigration: typeof runReviewMigration;
  runTraceStatus: typeof runTraceStatus;
  runTraceEnable: typeof runTraceEnable;
  runTraceDisable: typeof runTraceDisable;
  runTraceRepair: typeof runTraceRepair;
  runTraceList: typeof runTraceList;
  runTraceShow: typeof runTraceShow;
  runTracePull: typeof runTracePull;
  runTraceBlame: typeof runTraceBlame;
  runTraceHook: typeof runTraceHook;
  runTraceGitHook: typeof runTraceGitHook;
  runTraceSync: typeof runTraceSync;
  runTraceStorageUse: typeof runTraceStorageUse;
  runTraceConfigMigrate: typeof runTraceConfigMigrate;
  runTraceInstallMachine: typeof runTraceInstallMachine;
  runTraceOnboard: typeof runTraceOnboard;
  runTraceStoreDelete: typeof runTraceStoreDelete;
  runTraceStoreInfo: typeof runTraceStoreInfo;
  runTraceSessions: typeof runTraceSessions;
  runTraceAllow: typeof runTraceAllow;
  runTraceDeny: typeof runTraceDeny;
  runStoreLogin: typeof runStoreLogin;
  runStoreLogout: typeof runStoreLogout;
  runStoreWhoami: typeof runStoreWhoami;
}

export interface ReviewCliInput {
  argv: string[];
  cliVersion?: string;
  cliPaths?: { requestedPath: string; effectivePath: string };
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: CliInputStream;
  stdout: Writable;
  stderr: Writable;
  telemetry?: ReviewCommandTelemetry;
  runtime?: Partial<ReviewCliRuntime>;
}

interface ReviewInfoOptions {
  all?: boolean;
  session?: string;
}

type OutputSurface = ReviewCliCommand | "plain";

interface CliRunState {
  exitCode: number;
  parseSurface: OutputSurface;
  parserErrorOutput: string;
  json: boolean;
}

export async function runReviewCli(input: ReviewCliInput): Promise<number> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? env.INIT_CWD ?? process.cwd();

  // The command every installed hook re-enters. The Review CLI resolves it
  // the same way the hooks did on their own, so `review` behaves as before.
  const traceCommand = resolveTraceCommand({
    env,
    homeDir: traceHomeDir(env),
  });

  const scope = traceScope({ env, homeDir: traceHomeDir(env) });

  const cliVersion =
    input.cliVersion ?? readReviewPackageVersion(import.meta.url);

  const runtime = reviewCliRuntime(input.runtime);
  const telemetry = input.telemetry ?? ReviewTelemetry.fromEnv(env);

  const state: CliRunState = {
    exitCode: 0,
    parseSurface: "review",
    parserErrorOutput: "",
    json: jsonRequestedInArgv(input.argv),
  };

  let telemetryProperties: Record<
    string,
    boolean | number | string | null | undefined
  > = {};

  let activeTelemetry:
    | {
        command: ReviewCliCommandPath;
        commandRunId: string;
        startedAt: number;
        finished: boolean;
      }
    | undefined;

  const configureOutput = <T extends Command>(
    command: T,
    surface: OutputSurface,
  ): T => {
    command.configureOutput({
      writeOut: (message) => input.stdout.write(message),
      writeErr: (message) => {
        state.parseSurface = surface;
        state.parserErrorOutput += message;
      },
    });
    command.showHelpAfterError();

    return command;
  };

  // Every command accepts --json so an agent can pass it without first knowing
  // which commands support it. Commands that already write only JSON to stdout
  // treat it as a no-op; the rest switch stdout to events and push human
  // progress to stderr. A factory, not one shared Option: a shared instance
  // would propagate any later .default()/.conflicts() to every command.
  const configureJsonOutput = <T extends Command>(
    command: T,
    surface: OutputSurface,
  ): T =>
    configureOutput(command, surface).addOption(
      new Option("--json", "print machine-readable JSON events on stdout"),
    );

  const program = configureOutput(new Command(), "review")
    .name("whiteboard")
    .enablePositionalOptions()
    .version(cliVersion)
    .description("Create and open dev.fast reviews.")
    .addHelpText("after", reviewTopLevelHelp());

  // Tolerate the leading form (`whiteboard --json scaffold`) as well as the usual
  // trailing one. Never give this a .default(): optsWithGlobals merges globals
  // over locals, so a default would clobber a subcommand's own true.
  program.addOption(new Option("--json").hideHelp());
  program.option(
    "--state-dir <path>",
    "select headless Whiteboard state for server, api, and mcp",
  );
  program.exitOverride();

  const authoringEnv = (
    stateDir = program.opts<{ stateDir?: string }>().stateDir,
  ) =>
    stateDir
      ? { ...env, DEV_REVIEW_SERVER_DIR: path.resolve(cwd, stateDir) }
      : env;

  const serverCommand = configureOutput(
    program
      .command("server")
      .description("Run review authoring without Desktop"),
    "plain",
  );

  configureJsonOutput(
    serverCommand
      .command("start")
      .description(
        "Start the foreground authoring server; stop with Ctrl-C or SIGTERM",
      )
      .option(
        "--state-dir <path>",
        "directory for saved reviews and server discovery",
      )
      .option(
        "--port <port>",
        "loopback port (0 chooses an available port)",
        "0",
      )
      .option(
        "--software-maps",
        "allow the authoring skill to generate optional software maps",
      )
      .option(
        "--detach",
        "start the server in the background, logging to review-server/server.log",
      )
      .addOption(
        new Option("--started-by <who>")
          .choices(["user", "cli", "desktop"])
          .default("user")
          .hideHelp(),
      )
      // Batch authoring was removed; name that instead of "unknown option".
      .addOption(new Option("--authoring-mode <mode>").hideHelp()),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      port: string;
      softwareMaps?: boolean;
      detach?: boolean;
      startedBy: "user" | "cli" | "desktop";
      authoringMode?: string;
      json?: boolean;
    }>();

    if (options.authoringMode !== undefined)
      throw new Error(
        "--authoring-mode was removed with batch authoring; the server always authors interactively. Drop the option.",
      );
    const port = Number(options.port);

    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("--port must be an integer between 0 and 65535.");
    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));

    if (options.detach) {
      const { ensureBackgroundServer } =
        await import("./server/background-server.js");

      const { discovery, started } = await ensureBackgroundServer({
        stateDir,
        env,
        args: [
          "--port",
          `${port}`,
          ...(options.softwareMaps ? ["--software-maps"] : []),
        ],
      });

      await writeServerStatus(discovery, stateDir, options.json, { started });

      return;
    }

    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    try {
      const { runHeadlessServer } = await import("./server/headless-host.js");
      await runHeadlessServer({
        stateDir,
        port,
        softwareMapEnabled: options.softwareMaps,
        startedBy: options.startedBy,
        signal: controller.signal,
        telemetry,
        onReady: ({ url, serverPid }) => {
          input.stdout.write(
            options.json
              ? `${JSON.stringify({ event: "server.ready", url, serverPid, stateDir })}\n`
              : `Whiteboard server ready at ${url}\nSaved reviews: ${stateDir}\n`,
          );
        },
      });
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });

  configureJsonOutput(
    serverCommand
      .command("status")
      .description("Check whether the headless server is ready")
      .option(
        "--state-dir <path>",
        "directory selected when starting the server",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
    }>();

    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));
    const discovery = await readReviewServerDiscovery(stateDir);

    if (!discovery) throw serverNotReady(stateDir);
    await writeServerStatus(discovery, stateDir, options.json);
  });

  configureJsonOutput(
    serverCommand
      .command("stop")
      .description(
        "Stop a background server started by --detach, the CLI, or Desktop",
      )
      .option(
        "--state-dir <path>",
        "directory selected when starting the server",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
    }>();

    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));

    const { headlessServerOwner, stopBackgroundServer } =
      await import("./server/background-server.js");

    // The lock's live holder, answering or not: a hung server is stopped too.
    const owner = await headlessServerOwner(stateDir);
    const discovery = await readReviewServerDiscovery(stateDir);

    if (owner === undefined) {
      input.stdout.write(
        options.json
          ? `${JSON.stringify({ event: "server.stop", stopped: false, stateDir })}\n`
          : `No Whiteboard server is running in ${stateDir}.\n`,
      );

      return;
    }

    const serverPid = owner;

    if (discovery?.serverPid !== owner)
      throw new Error(
        `Process ${owner} holds the Whiteboard server's lock in ${stateDir} but has published no server; it may be starting. Try again, or end that process.`,
      );

    if (discovery.startedBy === "user")
      throw new Error(
        `The Whiteboard server in ${stateDir} (process ${serverPid}) runs in the foreground of \`whiteboard server start\`. Stop it there with Ctrl-C.`,
      );

    await stopBackgroundServer(discovery);

    input.stdout.write(
      options.json
        ? `${JSON.stringify({ event: "server.stop", stopped: true, serverPid, stateDir })}\n`
        : `Stopped the Whiteboard server (process ${serverPid}).\n`,
    );
  });

  configureJsonOutput(
    serverCommand
      .command("reset-id")
      .description(
        "Give this machine's saved reviews a new server id; stop the server first",
      )
      .option(
        "--state-dir <path>",
        "directory selected when starting the server",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
    }>();

    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));

    if (!existsSync(path.join(stateDir, "review-api.db")))
      throw new Error(
        `No saved reviews in ${stateDir}, so there is no server id to reset. Check --state-dir.`,
      );

    // Any live Desktop holds the store, attached window or not. Only a gone
    // process counts as stopped: a paused or busy one may not answer /health.
    const desktops = await readReviewInstances({
      env: { ...env, [DEV_REVIEW_HOME_ENV]: stateDir },
    });

    const [problem] = desktops.broken.values();

    if (problem)
      throw new Error(
        `Cannot tell whether a Whiteboard Desktop is using ${stateDir}: ${problem.message}`,
      );

    const inUse = () =>
      new Error(
        `A Whiteboard server is using ${stateDir}. Stop it first, then run whiteboard server reset-id again.`,
      );

    if (
      desktops.instances.some(({ discovery }) =>
        [discovery.appPid, discovery.serverPid].some((pid) =>
          processIsAlive(pid),
        ),
      )
    )
      throw inUse();

    const [{ openReviewProfile }, { withHeadlessServerLock }] =
      await Promise.all([
        import("./review-api/profile.js"),
        import("./server/headless-host.js"),
      ]);

    // The headless server's own lock (at the path it resolves): refused while
    // a live server holds it, and no server can start during the reset.
    const reset = await withHeadlessServerLock(
      await realpath(stateDir),
      async () => {
        const local = await openReviewProfile(stateDir, {
          manageWorkspaces: false,
        });

        try {
          return local.store.resetServerId();
        } finally {
          await local.data.close();
          await local.store.close();
        }
      },
    );

    if (!reset.acquired) throw inUse();
    const serverId = reset.result;

    input.stdout.write(
      options.json
        ? `${JSON.stringify({ event: "server.reset-id", serverId, stateDir })}\n`
        : `New server id ${serverId}\nSaved reviews: ${stateDir}\n`,
    );
  });

  const remote = configureOutput(
    program
      .command("remote")
      .description("Serve reviews to Whiteboard Desktop over SSH"),
    "plain",
  );

  configureJsonOutput(
    remote
      .command("attach")
      .description(
        "Start a background server if none is healthy and report how to reach it",
      )
      .option(
        "--state-dir <path>",
        "directory for saved reviews and server discovery",
      )
      .option(
        "--groups <groups>",
        "comma-separated optional extension groups the Desktop has enabled, such as go",
      )
      .option(
        "--replace",
        "stop a running server of another version that the CLI or Desktop started, and start this one",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
      groups?: string;
      replace?: boolean;
    }>();

    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));

    const { REMOTE_ATTACH_BEGIN, REMOTE_ATTACH_END, remoteAttach } =
      await import("./remote-attach.js");

    let attach: Awaited<ReturnType<typeof remoteAttach>>;

    try {
      attach = await remoteAttach({
        stateDir,
        env,
        stderr: input.stderr,
        groups: options.groups?.split(",").map((group) => group.trim()),
        replace: options.replace,
      });
    } catch (error) {
      if (!options.json) throw error;

      // Desktop reads only between the sentinels, so the reason goes there.
      let line = "";

      emitReviewEvent(
        new Writable({
          write(chunk, _encoding, done) {
            line += chunk;
            done();
          },
        }),
        { event: "error", error: serializeReviewError(error) },
      );
      input.stdout.write(
        `${REMOTE_ATTACH_BEGIN}\n${ensureTrailingNewline(line)}${REMOTE_ATTACH_END}\n`,
      );
      state.exitCode = 1;

      return;
    }

    // Sentinels let Desktop drop whatever the login shell prints around them.
    input.stdout.write(
      options.json
        ? `${REMOTE_ATTACH_BEGIN}\n${JSON.stringify(attach)}\n${REMOTE_ATTACH_END}\n`
        : `Whiteboard server ${attach.startedServer ? "started" : "already running"} at ${attach.url}\nStructural diff: ${attach.diffr ? "available" : "unavailable (no diffr)"}\nLanguage features: ${attach.languageServer ? `VS Code server on port ${attach.languageServer.port}` : `unavailable (${attach.languageServerDetail})`}\n`,
    );
  });

  configureJsonOutput(
    remote
      .command("extensions")
      .description("Language extensions for the VS Code server on a remote")
      .command("ensure")
      .description(
        "Download the curated extensions for this machine and list them for the VS Code server",
      )
      .option(
        "--groups <groups>",
        "comma-separated optional extension groups the Desktop has enabled, such as go",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const { json, groups } = command.optsWithGlobals<{
      json?: boolean;
      groups?: string;
    }>();

    const { ensureRemoteExtensions } = await import("./remote-extensions.js");

    const result = await ensureRemoteExtensions({
      env,
      groups: groups?.split(",").map((group) => group.trim()),
    });

    input.stdout.write(
      json
        ? `${JSON.stringify(result)}\n`
        : [
            ...result.installed.map((id) => `Installed ${id}`),
            ...result.skipped.map(
              ({ id, reason }) => `Skipped ${id}: ${reason}`,
            ),
            ...result.failed.map(({ id, error }) => `Failed ${id}: ${error}`),
          ]
            .map((line) => `${line}\n`)
            .join(""),
    );
    state.exitCode = result.failed.length > 0 ? 1 : 0;
  });

  // Desktop's installer runs this once a version is in place; attach runs the same fetch.
  configureJsonOutput(
    remote
      .command("diffr")
      .description("Structural diff on this host")
      .command("ensure")
      .description(
        "Fetch diffr for this platform unless a current copy is present",
      )
      .option(
        "--state-dir <path>",
        "directory for saved reviews and server discovery",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
    }>();

    const { ensureDiffr } = await import("./remote-attach.js");

    const diffr = await ensureDiffr({
      stateDir: reviewServerStateDir(authoringEnv(options.stateDir)),
      env,
      stderr: input.stderr,
    });

    input.stdout.write(
      options.json
        ? `${JSON.stringify({ event: "remote.diffr", diffr })}\n`
        : `Structural diff: ${diffr ? "available" : "unavailable (no diffr)"}\n`,
    );
  });

  configureJsonOutput(
    remote
      .command("uninstall")
      .description(
        "Remove what Whiteboard Desktop installed on this host, stopping a server it started",
      )
      .addOption(
        new Option(
          "--keep-reviews",
          "leave the saved reviews in place",
        ).conflicts("deleteReviews"),
      )
      .addOption(
        new Option("--delete-reviews", "also delete the saved reviews"),
      )
      .option(
        "--state-dir <path>",
        "directory for saved reviews and server discovery",
      ),
    "plain",
  ).action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{
      stateDir?: string;
      json?: boolean;
      keepReviews?: boolean;
      deleteReviews?: boolean;
    }>();

    const stateDir = reviewServerStateDir(authoringEnv(options.stateDir));
    // Loaded before the install it runs from is removed.
    const { remoteUninstall } = await import("./remote-uninstall.js");

    let deleteReviews = options.deleteReviews
      ? true
      : options.keepReviews
        ? false
        : undefined;

    if (deleteReviews === undefined && !options.json && input.stdin?.isTTY) {
      const prompt = createInterface({
        input: input.stdin,
        output: input.stderr,
      });

      try {
        deleteReviews = /^y(es)?$/i.test(
          (
            await prompt.question(
              `Also delete the saved reviews in ${stateDir}? [y/N] `,
            )
          ).trim(),
        );
      } finally {
        prompt.close();
      }
    }

    const result =
      deleteReviews === undefined
        ? {
            event: "remote.uninstall" as const,
            ok: false as const,
            reason:
              "Say what happens to the saved reviews: pass --keep-reviews or --delete-reviews.",
          }
        : await remoteUninstall({
            home: env.HOME ?? "",
            env,
            stateDir,
            deleteReviews,
          });

    if (!result.ok) {
      if (!options.json) throw new Error(result.reason);
      input.stdout.write(`${JSON.stringify(result)}\n`);
      state.exitCode = 1;

      return;
    }

    input.stdout.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : [
            ...(result.stoppedServer
              ? [
                  `Stopped the Whiteboard server (process ${result.stoppedServer.pid}).`,
                ]
              : []),
            ...result.removed.map((removed) => `Removed ${removed}`),
            result.keptReviews
              ? `Saved reviews kept in ${stateDir}`
              : "Saved reviews deleted.",
            "",
          ].join("\n"),
    );
  });

  async function writeServerStatus(
    discovery: ReviewServerDiscovery,
    stateDir: string,
    json: boolean | undefined,
    extra: { started?: boolean } = {},
  ) {
    const health = await readReviewServerHealth(discovery);

    if (!health) throw serverNotReady(stateDir);
    const { url, serverPid } = discovery;
    const { version, serverId } = health;
    input.stdout.write(
      json
        ? `${JSON.stringify({ event: "server.status", ready: true, url, serverPid, stateDir, version, serverId, ...extra })}\n`
        : `Whiteboard server ${extra.started === false ? "already running" : "ready"} at ${url}\nSaved reviews: ${stateDir}\n`,
    );
  }

  configureJsonOutput(
    program
      .command("version")
      .description("Print Whiteboard package version")
      .option("--verbose", "Show executing CLI paths and build identity"),
    "plain",
  ).action(async (options: { verbose?: boolean }, command: Command) => {
    const { json } = command.optsWithGlobals<{ json?: boolean }>();

    if (options.verbose) {
      const selection = await selectReviewInstance({ env });

      const info = {
        ...cliRuntimeInfo(
          input.cliPaths?.requestedPath ??
            path.resolve(process.argv[1] ?? fileURLToPath(import.meta.url)),
          input.cliPaths?.effectivePath,
        ),
        instance: selection.key,
        instanceRecord: selection.instance?.filePath ?? null,
      };

      input.stdout.write(
        json
          ? `${JSON.stringify(info)}\n`
          : `${describeCliRuntime(info)}Instance: ${info.instance} (${info.instanceRecord ?? "not running"})\n`,
      );
      state.exitCode = 0;

      return;
    }

    input.stdout.write(
      json
        ? `${JSON.stringify({ event: "version", version: cliVersion })}\n`
        : `${cliVersion}\n`,
    );
    state.exitCode = 0;
  });

  const writeAppEvent = (
    event: ReviewAppLaunchEvent | ReviewAppEvent,
    options: { json?: boolean; focus?: boolean },
  ) => {
    if (options.json) {
      input.stdout.write(`${JSON.stringify(event)}\n`);
    } else if (event.action === "launch") {
      input.stdout.write(
        event.state === "running"
          ? "Whiteboard Desktop is already running.\n"
          : options.focus
            ? "Whiteboard Desktop is ready.\n"
            : "Whiteboard Desktop is ready in the background. Pass --focus to bring it forward.\n",
      );
    } else {
      input.stdout.write(`Whiteboard Desktop is showing "${event.title}".\n`);
    }
  };

  const pickReview = async (options: {
    session?: string;
    focus?: boolean;
    json?: boolean;
  }) => {
    // SAFETY: the picker reads keypresses only after checking isTTY, and only
    // a tty.ReadStream reports isTTY; any other stream fails that check first.
    const event = await runtime.runReviewAppPick({
      cwd,
      reviewUuid: options.session,
      focus: options.focus,
      stdin: (input.stdin ?? process.stdin) as NodeJS.ReadStream,
      // This stream carries only the interactive picker. Under --json it must
      // not be stdout: the picker's ANSI frames would corrupt the event line.
      stdout: humanStream({ ...input, json: options.json }),
    });

    if (!event) {
      state.exitCode = 1;

      return;
    }

    writeAppEvent(event, options);
    state.exitCode = 0;
  };

  const launchApp = async (options: {
    focus?: boolean;
    json?: boolean;
    sandbox?: boolean;
  }) => {
    const event = await runtime.runReviewAppLaunch({
      focus: options.focus,
      noSandbox: options.sandbox === false,
    });

    writeAppEvent(event, options);
    state.exitCode = 0;
  };

  const app = configureJsonOutput(
    program
      .command("app")
      .description("Start Whiteboard Desktop in the background")
      .option("--focus", "bring Whiteboard Desktop to the foreground")
      .option(
        "--no-sandbox",
        "disable the Chromium sandbox for a Linux container",
      ),
    "plain",
  ).action(launchApp);

  configureJsonOutput(
    app
      .command("launch")
      .description("Start Whiteboard Desktop in the background")
      .option("--focus", "bring Whiteboard Desktop to the foreground")
      .option(
        "--no-sandbox",
        "disable the Chromium sandbox for a Linux container",
      ),
    "plain",
  ).action(launchApp);
  configureJsonOutput(
    app
      .command("pick")
      .description("Select a review (interactive picker without --session)")
      .option("--session <uuid>", "review UUID")
      .option("--focus", "bring Whiteboard Desktop to the foreground"),
    "plain",
  ).action(pickReview);

  const instanceOutput = (command: Command) => ({
    env,
    stdout: input.stdout,
    stderr: input.stderr,
    json: command.optsWithGlobals<{ json?: boolean }>().json,
  });

  const instances = configureJsonOutput(
    program
      .command("instances")
      .description("List running reviews and the one commands use"),
    "plain",
  ).action(async (_options: { json?: boolean }, command: Command) => {
    await listReviewInstancesCommand(instanceOutput(command));
    state.exitCode = 0;
  });

  configureJsonOutput(
    instances
      .command("use")
      .description("Make an instance this machine's default")
      .argument("<key>", "stable, preview, or a dev-… key"),
    "plain",
  ).action(
    async (key: string, _options: { json?: boolean }, command: Command) => {
      await useReviewInstance(key, instanceOutput(command));
      state.exitCode = 0;
    },
  );

  configureJsonOutput(
    instances.command("clear").description("Remove the machine default"),
    "plain",
  ).action(async (_options: { json?: boolean }, command: Command) => {
    await clearReviewInstance(instanceOutput(command));
    state.exitCode = 0;
  });

  configureJsonOutput(
    program.command("info").description("Print review information"),
    "plain",
  )
    .option("--all", "list active reviews for every worktree in this repo")
    .addOption(
      new Option("--session <uuid>", "select a review").conflicts("all"),
    )
    .action(async (options: ReviewInfoOptions) => {
      const event = await runtime.runReviewInfo({
        cwd,
        all: options.all,
        reviewUuid: options.session,
      });

      input.stdout.write(`${JSON.stringify(event)}\n`);
      state.exitCode = 0;
    });

  const connect = configureJsonOutput(
    program
      .command("connect")
      .description(
        "Print the prompt that connects a coding agent to Whiteboard",
      )
      .addArgument(
        new Argument("[target...]", "coding agent").choices([
          "claude",
          "claude-code",
          "codex",
          "cursor",
          "opencode",
          "pi",
          "omp",
          "copilot",
          "all",
        ]),
      )
      .addOption(
        new Option(
          "--detect",
          "list the agents on this machine and whether each is connected; changes nothing",
        ).conflicts("yes"),
      )
      .option(
        "--yes",
        "run the commands the prompt gives, without an agent: claude, codex, opencode or pi",
      ),
    "plain",
  );

  connect.action(
    async (
      targets: string[],
      options: { json?: boolean; detect?: boolean; yes?: boolean },
    ) => {
      const output = {
        json: options.json,
        stdout: input.stdout,
        stderr: input.stderr,
      };

      if (options.detect) {
        const agents = await detectAgents({ homeDir: scope.homeDir, env });

        if (options.json) {
          emitJsonEvent(output, { event: "connect.detect", agents });

          return;
        }

        humanStream(output).write(
          agents.length
            ? `${agents.map((agent) => `${agent.name}: ${agent.connected ? "connected" : "not connected"}${agent.manual ? " (its command is not on PATH)" : ""}`).join("\n")}\n`
            : "No agents found.\n",
        );

        return;
      }

      if (options.yes) {
        const agents = parseTargets(targets);

        if (
          targets.length === 0 ||
          !agents.every((target): target is AgentConnectTarget =>
            AGENT_CONNECT_TARGETS.some((known) => known === target),
          )
        )
          throw new Error(
            "connect --yes takes one or more of claude, codex, opencode or pi.",
          );

        const results = await connectAgents({
          agents,
          homeDir: scope.homeDir,
          env,
        });

        state.exitCode = results.every((result) => result.connected) ? 0 : 1;

        if (options.json) {
          emitJsonEvent(output, { event: "connect.run", agents: results });

          return;
        }

        humanStream(output).write(
          results
            .map(
              (result) =>
                `${result.output}${result.name}: ${result.connected ? "connected" : "not connected"}\n`,
            )
            .join(""),
        );

        return;
      }

      const selected = parseTargets(targets);

      const { homeDir, devHome } = scope;

      const prompts = connectPrompts({
        legacyPaths: await scanLegacySkills(homeDir),
        hasShim:
          (await isOwnedShim(pathShimPath(homeDir))) ||
          (await windowsInstallerCommand(
            findReviewPackageRoot(import.meta.url),
            env,
          )) !== undefined,
        traceEnabled: await traceMachineEnabled({ homeDir, env }),
        fffBinaryPath: path.join(homeDir, ".local", "bin", "fff-mcp"),
        fffCorpusRoot: path.join(devHome, "trace-search"),
      });

      if (options.json) {
        emitJsonEvent(output, {
          event: "connect",
          prompts: Object.fromEntries(
            selected.map((target) => [target, prompts[target]]),
          ),
        });

        return;
      }

      const sections = selected.map((target) =>
        selected.length > 1
          ? `## ${TARGET_LABELS[target]}\n\n${prompts[target]}`
          : prompts[target],
      );

      humanStream(output).write(`${sections.join("\n\n")}\n`);
    },
  );

  const migrate = configureOutput(
    program.command("migrate").description("Migrate legacy review data"),
    "plain",
  );

  configureJsonOutput(
    migrate
      .command("apply")
      .description("Apply the legacy review migration")
      .option("--force", "restart an interrupted migration"),
    "plain",
  ).action(async (options: { force?: boolean; json?: boolean }) => {
    state.exitCode = await runtime.runReviewMigration({
      env,
      force: options.force,
      json: options.json,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  });

  const share = configureJsonOutput(
    program
      .command("share")
      .description(
        "Upload an immutable review snapshot and return its share link",
      ),
    "plain",
  )
    .option("--review <id>", "review ID")
    .option("--version <number>", "Saved version to share")
    .option("--preview", "Open the share link in Whiteboard Preview by default")
    .option(
      "--request-id <uuid>",
      "Reuse this ID when retrying the same immutable upload",
    )
    .action(
      async (options: {
        session?: string;
        version?: string;
        requestId?: string;
        preview?: boolean;
        json?: boolean;
      }) => {
        const { runShareCli } = await import("./sharing/cli.js");
        state.exitCode = await runShareCli({
          ...input,
          ...options,
          env: authoringEnv(),
        });
      },
    );

  configureJsonOutput(
    share
      .command("revoke <share-id>")
      .description("Revoke future downloads of a share"),
    "plain",
  ).action(async (shareId: string, options: { json?: boolean }) => {
    const { runShareCli } = await import("./sharing/cli.js");
    state.exitCode = await runShareCli({
      ...input,
      ...options,
      revoke: shareId,
      env: authoringEnv(),
    });
  });

  // Hosted trace store login. Logging in authenticates a user; it selects
  // no storage by itself.
  configureJsonOutput(
    program.command("login").description("Log in to Whiteboard with GitHub"),
    "plain",
  )
    .option("--origin <url>", "Whiteboard service origin", DEFAULT_STORE_ORIGIN)
    .option("--traces", "Also authorize GitHub repositories for hosted traces")
    .option("--no-browser", "Print the URL instead of opening a browser")
    .action(
      async (options: {
        origin?: string;
        browser?: boolean;
        traces?: boolean;
        json?: boolean;
      }) => {
        state.exitCode = await runtime.runStoreLogin({
          origin: options.origin,
          noBrowser: options.browser === false,
          traces: options.traces === true,
          json: options.json,
          stdout: input.stdout,
          stderr: input.stderr,
        });

        if (state.exitCode === 0)
          await attemptTelemetry(() =>
            aliasInstallationToAccount(telemetry, env),
          );
      },
    );

  program
    .command("logout")
    .description("Forget the hosted trace store login")
    .action(async () => {
      state.exitCode = await runtime.runStoreLogout({ stdout: input.stdout });
    });

  configureJsonOutput(
    program.command("whoami").description("Show the hosted trace store login"),
    "plain",
  ).action(async (options: { json?: boolean }) => {
    state.exitCode = await runtime.runStoreWhoami({
      json: options.json,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  });

  // The trace surface: inspect storage, manage one repository, or read events.
  const trace = configureOutput(
    program.command("trace").description("Manage agent traces"),
    "plain",
  );

  registerTraceCommands(trace, {
    runtime,
    traceCommand,
    scope,
    cwd,
    stdin: input.stdin,
    stdout: input.stdout,
    stderr: input.stderr,
    configureOutput: (command) => configureOutput(command, "plain"),
    configureJsonOutput: (command) => configureJsonOutput(command, "plain"),
    verifyCommand: "whiteboard trace status",
    setExitCode: (code) => {
      state.exitCode = code;
    },
  });

  // Storage selection and configuration migration write only the shared
  // trace config; legacy files and remote objects are never touched.
  const traceStorage = configureOutput(
    trace.command("storage").description("Select the trace store"),
    "plain",
  );

  configureJsonOutput(
    traceStorage
      .command("use <mode>")
      .description("Select the s3 (S3/R2 bucket) or hosted trace store")
      .option("--origin <url>", "hosted store origin")
      .option("--endpoint <url>", "S3/R2 endpoint URL (s3)")
      .option("--bucket <name>", "S3/R2 bucket name (s3)")
      .option("--key <id>", "S3/R2 access key ID (s3)")
      .option("--secret <key>", "S3/R2 secret access key (s3)")
      .option("--region <region>", "S3/R2 signing region (s3)"),
    "plain",
  ).action(
    async (
      mode: string,
      options: {
        origin?: string;
        endpoint?: string;
        bucket?: string;
        key?: string;
        secret?: string;
        region?: string;
        json?: boolean;
      },
    ) => {
      state.exitCode = await runtime.runTraceStorageUse({
        cwd,
        mode,
        origin: options.origin,
        endpoint: options.endpoint,
        bucket: options.bucket,
        key: options.key,
        secret: options.secret,
        region: options.region,
        json: options.json,
        stdout: input.stdout,
        stderr: input.stderr,
      });
    },
  );

  const traceConfig = configureOutput(
    trace.command("config").description("Manage trace storage configuration"),
    "plain",
  );

  configureJsonOutput(
    traceConfig
      .command("migrate")
      .description(
        "Copy the legacy S3/R2 setup into $DEV_REVIEW_HOME/trace/config.json",
      )
      .option("--dry-run", "preview without writing")
      .option(
        "--keep-legacy",
        "leave the legacy env and settings files in place instead of renaming them to legacy_*",
      ),
    "plain",
  ).action(
    async (options: {
      dryRun?: boolean;
      keepLegacy?: boolean;
      json?: boolean;
    }) => {
      state.exitCode = await runtime.runTraceConfigMigrate({
        dryRun: options.dryRun,
        keepLegacy: options.keepLegacy,
        json: options.json,
        stdout: input.stdout,
        stderr: input.stderr,
      });
    },
  );

  // Keep the established Review help order while app-only commands stay here.
  const traceHelp = trace.createHelp();

  trace.configureHelp({
    visibleCommands: (command) => {
      const commands = traceHelp.visibleCommands(command);
      commands.splice(commands.indexOf(traceStorage), 1);
      commands.splice(1, 0, traceStorage);
      commands.splice(commands.indexOf(traceConfig), 1);
      commands.splice(6, 0, traceConfig);

      return commands;
    },
  });

  // The JSON authoring surface is owned by review-api/agent-cli.ts. Commander
  // passes the tool name and JSON payload through untouched, so these commands
  // share the top-level help, the leading `--json` form, and the telemetry
  // hooks without a separate parser.
  for (const [name, description] of [
    ["api", "Call a JSON review authoring tool on the running server"],
    ["mcp", "Serve the JSON review authoring tools over stdio MCP"],
  ] as const) {
    configureOutput(
      program
        .command(name)
        .description(description)
        .argument("[args...]", "tool name and JSON input")
        .allowUnknownOption()
        .allowExcessArguments()
        .helpOption(false)
        .passThroughOptions()
        .addHelpText("after", `\n${reviewAgentCliHelp}`),
      "plain",
    ).action(async (args: string[]) => {
      const { runReviewAgentCli } = await import("./review-api/agent-cli.js");
      state.exitCode = await runReviewAgentCli({
        ...input,
        env: authoringEnv(),
        argv: [name, ...args],
        onToolCall: (call) =>
          attemptTelemetry(() => telemetry.captureToolCalled(call)),
      });
    });
  }

  program.hook("preAction", async (_command, actionCommand) => {
    // The parsed option is authoritative once parsing succeeds. The argv scan
    // that seeded state.json only has to cover parse failures.
    if (actionCommand.optsWithGlobals().json === true) {
      state.json = true;
    }

    const command = telemetryCommandPath(actionCommand);

    if (!command) return;
    const commandRunId = telemetry.createCommandRunId();
    setTraceAttribute("command", command);
    setTraceAttribute("commandRunId", commandRunId);
    telemetry.setSurface(commandSurface(command));
    activeTelemetry = {
      command,
      commandRunId,
      startedAt: Date.now(),
      finished: false,
    };
    await attemptTelemetry(() => telemetry.captureInstallationCreated());
    await attemptTelemetry(() =>
      telemetry.captureCommandStarted({ command, commandRunId }),
    );
  });
  program.hook("postAction", async () => {
    await finishActiveTelemetry(
      telemetry,
      activeTelemetry,
      state.exitCode,
      undefined,
      telemetryProperties,
    );
  });

  try {
    await withStoreAuthorization(
      async (origin) => {
        if (
          state.json ||
          input.stdin?.isTTY !== true ||
          input.argv[0] !== "trace" ||
          input.argv.some((arg) => /hook/i.test(arg))
        )
          return undefined;

        const prompt = createInterface({
          input: input.stdin,
          output: input.stderr,
        });

        let answer: string;

        try {
          answer = await prompt.question(
            "Authorize GitHub repositories for hosted traces? [y/N] ",
          );
        } finally {
          prompt.close();
        }

        if (!/^y(es)?$/i.test(answer.trim())) return undefined;

        const code = await runtime.runStoreLogin({
          origin,
          traces: true,
          stdout: input.stdout,
          stderr: input.stderr,
          env: input.env,
        });

        return code === 0 ? (await readStoreAuth(input.env))?.token : undefined;
      },
      () => program.parseAsync(input.argv, { from: "user" }),
    );

    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) {
        await captureOneOffCommand(
          telemetry,
          input.argv.includes("--version") || input.argv.includes("-V")
            ? "version"
            : "help",
          0,
        );

        return 0;
      }

      const surface = state.parseSurface;

      // stdout carries the parseable failure whenever the caller asked for
      // JSON; stderr keeps the commander message and the help that
      // showHelpAfterError() produced, because a human may be reading too.
      if (state.json || surface === "review") {
        emitReviewEvent(input.stdout, {
          event: "error",
          error: {
            name: "ReviewCliUsageError",
            message: commanderErrorMessage(error),
          },
        });
      }

      if (surface !== "review") {
        input.stderr.write(
          state.parserErrorOutput || ensureTrailingNewline(error.message),
        );
      }

      await finishActiveTelemetry(
        telemetry,
        activeTelemetry,
        1,
        error,
        telemetryProperties,
      );

      if (!activeTelemetry) {
        await captureOneOffCommand(telemetry, "invalid", 1, error);
      }

      return 1;
    }

    if (state.json) {
      const serialized: ReturnType<typeof serializeReviewError> & {
        code?: string;
        remedy?: string;
      } = serializeReviewError(error);

      if (
        error instanceof StoreApiError &&
        error.code === "repository_authorization_required"
      ) {
        serialized.code = error.code;
        serialized.remedy = "whiteboard login --traces";
      }

      emitReviewEvent(input.stdout, { event: "error", error: serialized });
    } else {
      input.stderr.write(ensureTrailingNewline(formatCliError(error)));
    }

    await finishActiveTelemetry(
      telemetry,
      activeTelemetry,
      1,
      error,
      telemetryProperties,
    );

    return 1;
  } finally {
    await attemptTelemetry(() => telemetry.shutdown(1_000));
  }
}

const TARGET_LABELS: Record<InstallTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "oh-my-pi",
  copilot: "Copilot CLI",
};

function parseTargets(targets: readonly string[]): InstallTarget[] {
  if (targets.length === 0 || targets.includes("all")) {
    return [...ALL_INSTALL_TARGETS];
  }

  return [
    ...new Set(
      targets
        .values()
        .map((target) => (target === "claude-code" ? "claude" : target))
        .filter(isInstallTarget),
    ),
  ];
}

function reviewCliRuntime(
  overrides: Partial<ReviewCliRuntime> | undefined,
): ReviewCliRuntime {
  return {
    runReviewAppLaunch,
    runReviewAppPick,
    runReviewInfo,
    runReviewMigration,
    runTraceStatus,
    runTraceEnable,
    runTraceDisable,
    runTraceRepair,
    runTraceList,
    runTraceShow,
    runTracePull,
    runTraceBlame,
    runTraceHook,
    runTraceGitHook,
    runTraceSync,
    runTraceStorageUse,
    runTraceConfigMigrate,
    runTraceInstallMachine,
    runTraceOnboard,
    runTraceStoreDelete,
    runTraceStoreInfo,
    runTraceSessions,
    runTraceAllow,
    runTraceDeny,
    runStoreLogin,
    runStoreLogout,
    runStoreWhoami,
    ...overrides,
  };
}

function reviewTopLevelHelp(): string {
  return [
    "",
    "Use `whiteboard info` to discover review documents for this checkout.",
    "Reviews are authored through the JSON API: `whiteboard api tools` lists the tools, and `whiteboard mcp` serves the same catalog to an agent.",
    "Use `whiteboard app launch` to start Whiteboard Desktop. Use `whiteboard app pick --session <uuid>` to open one.",
    "Use `whiteboard server start` for headless authoring, and `whiteboard server status --json` to check readiness.",
    "",
    "Every command accepts --json. Stdout then carries only JSON events, one per line,",
    "human progress moves to stderr, and a failure prints a JSON error event too.",
    "",
    "Example agent prompt (for a repository that provides a CI/CD system):",
    "",
    "  Can you use Whiteboard to explain this repository's CI/CD system to me?",
    "",
    "  My current understanding:",
    "",
    "  1. CI/CD can be configured entirely in JavaScript. There is no YAML;",
    "     everything is code.",
    "  2. I expect it to look somewhat like Dagger, where user-authored code",
    "     makes RPC-style calls into a build system.",
    "",
    "  I have a lot of questions, so please start at a high level:",
    "",
    "  1. Give me a two-sentence introduction, followed by two or three goals",
    "     and non-goals for the repository.",
    "  2. Explain the CI/CD APIs it exposes and how a user would use them.",
    "  3. Show sequence diagrams for the main user flows, including setting up",
    "     a pipeline and pushing a change.",
    "  4. Show database views for the Cloudflare D1 and Worker access patterns,",
    "     with walkthroughs linked to the relevant code.",
    "",
    "  Start concise and let me dig deeper through the canvas.",
  ].join("\n");
}

async function finishActiveTelemetry(
  telemetry: ReviewCommandTelemetry,
  active:
    | {
        command: ReviewCliCommandPath;
        commandRunId: string;
        startedAt: number;
        finished: boolean;
      }
    | undefined,
  exitCode: number,
  cause?: unknown,
  properties: Record<string, boolean | number | string | null | undefined> = {},
): Promise<void> {
  if (!active || active.finished) return;
  active.finished = true;
  const classification = errorClassification(active.command, cause);
  await attemptTelemetry(() =>
    exitCode === 0
      ? telemetry.captureCommandSucceeded({
          command: active.command,
          commandRunId: active.commandRunId,
          exitCode,
          durationMs: Date.now() - active.startedAt,
          properties,
        })
      : telemetry.captureCommandFailed({
          command: active.command,
          commandRunId: active.commandRunId,
          exitCode,
          durationMs: Date.now() - active.startedAt,
          properties,
          ...classification,
        }),
  );
}

async function captureOneOffCommand(
  telemetry: ReviewCommandTelemetry,
  command: ReviewCliCommandPath,
  exitCode: number,
  cause?: unknown,
): Promise<void> {
  const commandRunId = telemetry.createCommandRunId();
  await attemptTelemetry(() => telemetry.captureInstallationCreated());
  await attemptTelemetry(() =>
    telemetry.captureCommandStarted({ command, commandRunId }),
  );
  const classification = errorClassification(command, cause);
  await attemptTelemetry(() =>
    exitCode === 0
      ? telemetry.captureCommandSucceeded({
          command,
          commandRunId,
          exitCode,
          durationMs: 0,
        })
      : telemetry.captureCommandFailed({
          command,
          commandRunId,
          exitCode,
          durationMs: 0,
          ...classification,
        }),
  );
}

function telemetryCommandPath(
  command: Command,
): ReviewCliCommandPath | undefined {
  const name = command.name();
  const parent = command.parent?.name();

  if (parent === "migrate" && name === "apply") return "migrate.apply";

  if (parent === "trace") {
    if (name === "allow" || name === "deny" || name === "install") {
      return `trace.${name}`;
    }
  }

  if (parent === "store" && command.parent?.parent?.name() === "trace") {
    if (name === "create" || name === "delete" || name === "info") {
      return `trace.store.${name}`;
    }
  }

  if (parent === "storage" && name === "use") return "trace.storage.use";

  if (parent === "config" && name === "migrate") return "trace.config.migrate";

  if (parent === "server" && name === "start") return "server.start";

  if (name === "login" || name === "logout" || name === "whoami") return name;

  if (name === "api" || name === "mcp" || name === "connect") return name;

  if (parent === "app" && (name === "launch" || name === "pick")) {
    return `app.${name}`;
  }

  if (parent === "instances" && (name === "use" || name === "clear"))
    return `instances.${name}`;

  if (name === "version" || name === "info" || name === "instances") {
    return name;
  }

  // Bare `app` takes no --session; picking is only `app pick`.
  if (name === "app") return "app.launch";

  return undefined;
}

function commandSurface(command: ReviewCliCommandPath): ReviewTelemetrySurface {
  if (command === "server.start") return "headless";

  if (command === "mcp") return "mcp";

  if (command === "api") return "api";

  return "cli";
}

interface ErrorClassification {
  errorName: ReviewTelemetryErrorName;
  errorCategory: ReviewTelemetryErrorCategory;
}

function errorClassification(
  command: ReviewCliCommandPath,
  cause: unknown,
): ErrorClassification {
  if (cause instanceof CommanderError || command === "invalid") {
    return { errorName: "usage_error", errorCategory: "user_input" };
  }

  const name = cause instanceof Error ? cause.name.toLowerCase() : "";

  if (name.includes("notfound")) {
    return { errorName: "review_not_found", errorCategory: "local_state" };
  }

  if (command.startsWith("app.")) {
    return {
      errorName: "desktop_connection_error",
      errorCategory: "dependency",
    };
  }

  if (command === "info") {
    return { errorName: "review_state_error", errorCategory: "local_state" };
  }

  if (cause) {
    return { errorName: "unexpected_error", errorCategory: "internal" };
  }

  return { errorName: "process_error", errorCategory: "dependency" };
}

async function attemptTelemetry(fn: () => Promise<void>): Promise<void> {
  try {
    await span("telemetry capture", fn);
  } catch {
    // Telemetry must never affect CLI behavior.
  }
}

function commanderErrorMessage(error: CommanderError): string {
  return error.message.replace(/^error:\s*/i, "");
}

function formatCliError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.stack || `${cause.name}: ${cause.message}`;
  }

  return String(cause);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
