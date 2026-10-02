import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  REVIEW_DESKTOP_DISCOVERY_VERSION,
  type ReviewDesktopDiscovery,
} from "@dev.fast/review-protocol";
import { describe, expect, it, vi } from "vitest";

import type { ReviewInstanceSelection } from "./desktop-discovery";
import {
  type LaunchDesktopApplicationInput,
  launchDesktopApplication,
  runReviewAppLaunch,
} from "./review-app-launcher";
import { selectingDesktop } from "./review-test-utils";

const discovery: ReviewDesktopDiscovery = {
  version: REVIEW_DESKTOP_DISCOVERY_VERSION,
  instanceId: "desktop-1",
  url: "http://127.0.0.1:5570",
  appPid: 1,
  serverPid: 2,
  token: "secret",
  startedAt: 3,
};

describe("Review Desktop launcher", () => {
  it.each([
    [undefined, [[`${discovery.url}/health`, "GET", null]]],
    [
      true,
      [
        [`${discovery.url}/health`, "GET", null],
        [`${discovery.url}/app/focus`, "POST", discovery.token],
      ],
    ],
  ])(
    "reuses a healthy instance and focuses it only when asked: focus=%s",
    async (focus, requests) => {
      const launchDesktop = vi.fn<typeof launchDesktopApplication>(() =>
        pendingAttempt(),
      );

      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(healthyResponse())
        .mockResolvedValueOnce(Response.json({ ok: true }));

      await expect(
        runReviewAppLaunch(
          { focus },
          {
            selectInstance: selectingDesktop(async () => discovery, fetch),
            fetch,
            launchDesktop,
          },
        ),
      ).resolves.toEqual({
        event: "app",
        action: "launch",
        state: "running",
        instanceId: discovery.instanceId,
      });
      expect(
        fetch.mock.calls.map(([url, init]) => [
          String(url),
          init?.method ?? "GET",
          new Headers(init?.headers).get("x-review-token"),
        ]),
      ).toEqual(requests);
      expect(launchDesktop).not.toHaveBeenCalled();
    },
  );

  it("launches when discovery is missing", async () => {
    let readCount = 0;

    const launchDesktop = vi.fn<typeof launchDesktopApplication>(() =>
      pendingAttempt(),
    );

    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000, noSandbox: true },
        launcherRuntime([healthyResponse()], launchDesktop, async () =>
          readCount++ === 0 ? null : discovery,
        ),
      ),
    ).resolves.toMatchObject({ state: "launched" });
    expect(launchDesktop).toHaveBeenCalledWith({
      focus: undefined,
      noSandbox: true,
    });
  });

  it.each([
    [
      { key: "preview", source: "env" },
      { key: "preview", appPath: undefined },
    ],
    [{ key: "stable", source: "fallback" }, undefined],
  ] as const)(
    "launches the selected release instance: %j",
    async (selection, instance) => {
      let readCount = 0;

      const launchDesktop = vi.fn<typeof launchDesktopApplication>(() =>
        pendingAttempt(),
      );

      await runReviewAppLaunch(
        { timeoutMs: 1_000 },
        launcherRuntime(
          [healthyResponse()],
          launchDesktop,
          async () => (readCount++ === 0 ? null : discovery),
          selection,
        ),
      );
      expect(launchDesktop).toHaveBeenCalledWith(
        instance
          ? { focus: undefined, noSandbox: undefined, instance }
          : { focus: undefined, noSandbox: undefined },
      );
    },
  );

  it("never auto-launches a dev checkout", async () => {
    const launchDesktop = vi.fn<typeof launchDesktopApplication>();
    await expect(
      runReviewAppLaunch(
        {},
        launcherRuntime([], launchDesktop, async () => null, {
          key: "dev-review-0123456789ab",
          source: "default",
        }),
      ),
    ).rejects.toThrow("Start it with `pnpm dev` in its checkout");
    expect(launchDesktop).not.toHaveBeenCalled();
  });

  it("ignores unreadable discovery and launches Desktop", async () => {
    let readCount = 0;
    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        launcherRuntime(
          [healthyResponse()],
          vi.fn<typeof launchDesktopApplication>(() => pendingAttempt()),
          async () => {
            if (readCount++ === 0) throw new Error("unreadable discovery");

            return discovery;
          },
        ),
      ),
    ).resolves.toMatchObject({ state: "launched" });
  });

  it("ignores stale discovery and waits for the new instance", async () => {
    const fresh = { ...discovery, instanceId: "desktop-2" };
    let readCount = 0;

    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ok: false }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          instanceId: fresh.instanceId,
          desktopAttached: true,
        }),
      );

    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        {
          selectInstance: selectingDesktop(
            async () => (readCount++ === 0 ? discovery : fresh),
            fetch,
          ),
          fetch,
          launchDesktop: () => pendingAttempt(),
          now: () => 0,
          wait: async () => undefined,
        },
      ),
    ).resolves.toMatchObject({
      state: "launched",
      instanceId: fresh.instanceId,
    });
  });

  it("polls through delayed server and Desktop attachment", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          instanceId: discovery.instanceId,
          desktopAttached: false,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          instanceId: discovery.instanceId,
          desktopAttached: true,
        }),
      );

    let now = 0;
    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        {
          selectInstance: selectingDesktop(async () => discovery, fetch),
          fetch,
          launchDesktop: () => pendingAttempt(),
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds;
          },
        },
      ),
    ).resolves.toMatchObject({ state: "launched" });
  });

  it("reports the launch method and recovery after an early exit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        {
          selectInstance: selectingDesktop(async () => null, fetch),
          fetch,
          launchDesktop: () => ({
            method: 'the macOS bundle identifier "dev.fast.review"',
            completion: Promise.resolve({ code: 1, signal: null }),
          }),
          now: () => 0,
          wait: () => new Promise(() => undefined),
        },
      ),
    ).rejects.toThrow(
      'Could not launch Whiteboard with the macOS bundle identifier "dev.fast.review": the launch process exited with code 1. Open Whiteboard once, then run `whiteboard app launch` again. A sandboxed agent must run it outside the sandbox.',
    );
  });

  it("observes an asynchronous spawn failure while health polling is pending", async () => {
    let readCount = 0;

    const fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      return Response.json({ ok: false });
    };

    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        {
          selectInstance: selectingDesktop(
            async () => (readCount++ === 0 ? null : discovery),
            fetch,
          ),
          fetch,
          launchDesktop: () => ({
            method: 'the Desktop-managed bundle at "/missing/Review"',
            completion: Promise.reject(new Error("spawn ENOENT")),
          }),
          now: () => 0,
          wait: () => new Promise(() => undefined),
        },
      ),
    ).rejects.toThrow(
      'Could not launch Whiteboard with the Desktop-managed bundle at "/missing/Review": spawn ENOENT.',
    );
  });

  it("reports a successful Electron exit before Desktop becomes ready", async () => {
    let now = 0;
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      runReviewAppLaunch(
        { timeoutMs: 1_000 },
        {
          selectInstance: selectingDesktop(async () => null, fetch),
          fetch,
          launchDesktop: () => ({
            method: 'the Desktop-managed bundle at "/tmp/Review"',
            completion: Promise.resolve({ code: 0, signal: null }),
          }),
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds;
          },
        },
      ),
    ).rejects.toThrow(
      'Could not launch Whiteboard with the Desktop-managed bundle at "/tmp/Review": the launch process exited before Desktop became ready.',
    );
  });

  it.each([
    [
      undefined,
      [
        "-n",
        "-W",
        "-g",
        "-a",
        "/tmp/Review.app",
        "--env",
        "DEV_REVIEW_HOME=/tmp/home",
        "--env",
        "DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1",
      ],
    ],
    [
      true,
      [
        "-n",
        "-W",
        "-a",
        "/tmp/Review.app",
        "--env",
        "DEV_REVIEW_HOME=/tmp/home",
      ],
    ],
  ])(
    "opens the CLI's own bundle through LaunchServices with Review's env, focus=%s",
    (focus, args) => {
      const child = new FakeChild();

      const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
        () => child,
      );

      launchDesktopApplication({
        platform: "darwin",
        electron: true,
        execPath: "/tmp/Review.app/Contents/MacOS/Review",
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          DEV_REVIEW_HOME: "/tmp/home",
          DEV_FAST_REVIEW_CHECKOUT: "/tmp/checkout",
          PATH: "/usr/bin",
        },
        focus,
        spawn,
      });

      expect(spawn).toHaveBeenCalledWith(
        "/usr/bin/open",
        args,
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(child.unref).toHaveBeenCalledOnce();
    },
  );

  it("passes the isolated Desktop profile through open's --args", () => {
    const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
      () => new FakeChild(),
    );

    launchDesktopApplication({
      platform: "darwin",
      electron: true,
      focus: true,
      execPath: "/tmp/Review.app/Contents/MacOS/Review",
      env: { DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: "/tmp/review-state" },
      spawn,
    });
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "-n",
      "-W",
      "-a",
      "/tmp/Review.app",
      "--env",
      "DEV_FAST_REVIEW_DESKTOP_STATE_ROOT=/tmp/review-state",
      "--args",
      "--user-data-dir=/tmp/review-state/user-data",
      "--extensions-dir=/tmp/review-state/extensions",
    ]);
  });

  it.each([
    [{ key: "preview" as const }, ["-b", "dev.fast.review.preview"]],
    [
      { key: "preview" as const, appPath: "/Apps/Preview.app" },
      ["-a", "/Apps/Preview.app"],
    ],
  ])(
    "opens a selected instance over the CLI's own bundle",
    (instance, target) => {
      const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
        () => new FakeChild(),
      );

      launchDesktopApplication({
        platform: "darwin",
        electron: true,
        focus: true,
        execPath: "/tmp/Review.app/Contents/MacOS/Review",
        env: {},
        instance,
        spawn,
      });
      expect(spawn.mock.calls[0]?.[1]).toEqual(["-n", "-W", ...target]);
    },
  );

  it("opens the stable bundle identifier from a standalone CLI", () => {
    const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
      () => new FakeChild(),
    );

    launchDesktopApplication({
      platform: "darwin",
      electron: false,
      focus: true,
      env: {},
      spawn,
    });
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "-n",
      "-W",
      "-b",
      "dev.fast.review",
    ]);
  });

  it.each([
    [false, "/usr/bin/review-desktop", false],
    [true, "/usr/share/review/review", false],
    [true, "/usr/share/review/review", true],
  ])(
    "launches Linux with bundled Electron=%s and preserves the isolated profile",
    (electron, executable, noSandbox) => {
      const child = new FakeChild();

      const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
        () => child,
      );

      const environment = {
        ELECTRON_RUN_AS_NODE: "1",
        DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: "/tmp/linux-profile",
        VSCODE_DEV: "1",
        VSCODE_CLI: "1",
      };

      launchDesktopApplication({
        platform: "linux",
        electron,
        noSandbox,
        execPath: "/usr/share/review/review",
        env: environment,
        spawn,
      });

      expect(spawn).toHaveBeenCalledWith(
        executable,
        [
          "--user-data-dir=/tmp/linux-profile/user-data",
          "--extensions-dir=/tmp/linux-profile/extensions",
          ...(noSandbox ? ["--no-sandbox"] : []),
        ],
        expect.objectContaining({
          env: {
            DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: "/tmp/linux-profile",
            DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1",
          },
          detached: true,
          stdio: ["ignore", "ignore", expect.any(Number)],
        }),
      );
      expect(environment.ELECTRON_RUN_AS_NODE).toBe("1");
    },
  );

  it.each([false, true])(
    "launches the channel's own Linux launcher when the CLI wrapper names it, Electron=%s",
    (electron) => {
      const child = new FakeChild();

      const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
        () => child,
      );

      const attempt = launchDesktopApplication({
        platform: "linux",
        electron,
        env: {
          DEV_FAST_REVIEW_DESKTOP_COMMAND: "/usr/bin/review-preview-desktop",
        },
        spawn,
      });

      expect(spawn).toHaveBeenCalledWith(
        "/usr/bin/review-preview-desktop",
        [],
        expect.objectContaining({ detached: true }),
      );
      expect(attempt.method).toContain("/usr/bin/review-preview-desktop");
    },
  );

  it.each([
    [
      "darwin",
      { key: "preview" },
      "/usr/bin/open",
      ["-n", "-W", "-g", "-b", "dev.fast.review.preview"],
    ],
    [
      "darwin",
      { key: "preview", appPath: "/Users/me/Apps/Review Preview.app" },
      "/usr/bin/open",
      ["-n", "-W", "-g", "-a", "/Users/me/Apps/Review Preview.app"],
    ],
    ["linux", { key: "preview" }, "/usr/bin/review-preview-desktop", []],
  ] as const)(
    "opens the selected channel on %s: %j",
    (platform, instance, command, args) => {
      const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
        () => new FakeChild(),
      );

      launchDesktopApplication({
        platform,
        electron: false,
        instance,
        env: {
          DEV_FAST_REVIEW_DESKTOP_COMMAND: "/usr/bin/review-desktop",
          DEV_FAST_REVIEW_CHECKOUT: "/src/review",
        },
        spawn,
      });

      const [spawned, spawnedArgs, options] = spawn.mock.calls[0]!;
      expect(spawned).toBe(command);
      expect(spawnedArgs.slice(0, args.length)).toEqual(args);
      expect(options.env?.DEV_FAST_REVIEW_CHECKOUT).toBeUndefined();
    },
  );

  it("does not mark a focused direct launch as background", () => {
    const child = new FakeChild();

    const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
      () => child,
    );

    launchDesktopApplication({
      platform: "linux",
      electron: false,
      focus: true,
      env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
      spawn,
    });
    const options = spawn.mock.calls[0]?.[2];
    expect(options?.env).not.toHaveProperty(
      "DEV_FAST_REVIEW_DESKTOP_BACKGROUND",
    );
  });

  it("releases captured output while Desktop is still running", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "launch-capture-test-"));
    const metadata = path.join(root, "child.json");
    let timer: ReturnType<typeof setTimeout> | undefined;

    const script = `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      import { launchDesktopApplication } from ${JSON.stringify(new URL("./review-app-launcher.ts", import.meta.url).href)};
      let pid;
      const attempt = launchDesktopApplication({
        platform: "linux", electron: false,
        spawn: (_command, _args, options) => {
          const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
          pid = child.pid;
          return child;
        },
      });
      writeFileSync(${JSON.stringify(metadata)}, JSON.stringify({ pid, logPath: attempt.logPath }));
      console.log("parent done");
    `;

    try {
      const captured = promisify(execFile)(process.execPath, [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        script,
      ]);

      const result = await Promise.race([
        captured,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Captured output remained open")),
            5_000,
          );
        }),
      ]);

      expect(result.stdout.trim()).toBe("parent done");
      expect(result.stderr).toBe("");
      const { pid, logPath } = JSON.parse(readFileSync(metadata, "utf8"));
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(statSync(logPath).mode & 0o777).toBe(0o600);
    } finally {
      clearTimeout(timer);

      if (existsSync(metadata)) {
        const { pid, logPath } = JSON.parse(readFileSync(metadata, "utf8"));
        process.kill(pid, "SIGTERM");
        rmSync(path.dirname(logPath), { recursive: true, force: true });
      }

      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes bounded Desktop diagnostics on startup failure", async () => {
    let logPath: string | undefined;
    const diagnostic = "Running as root without --no-sandbox is not supported.";

    try {
      await expect(
        runReviewAppLaunch(
          {},
          {
            selectInstance: async () => ({
              key: "stable",
              source: "fallback",
              instances: [],
            }),
            launchDesktop: () => {
              const attempt = launchDesktopApplication({
                platform: "linux",
                electron: false,
                spawn: (_command, _args, options) =>
                  spawn(
                    process.execPath,
                    [
                      "-e",
                      `process.stderr.write(${JSON.stringify("x".repeat(20_000) + "\n" + diagnostic)}); process.exitCode = 1;`,
                    ],
                    options,
                  ),
              });

              logPath = attempt.logPath;

              return attempt;
            },
          },
        ),
      ).rejects.toSatisfy((error: Error) => {
        expect(error.message).toContain(diagnostic);
        expect(error.message).toContain(logPath);
        expect(error.message.length).toBeLessThan(17_000);

        return true;
      });
    } finally {
      if (logPath)
        rmSync(path.dirname(logPath), { recursive: true, force: true });
    }
  });

  it("reports a missing Linux package launcher", async () => {
    const child = new FakeChild();

    const attempt = launchDesktopApplication({
      platform: "linux",
      electron: false,
      spawn: () => child,
    });

    child.emit("error", new Error("spawn /usr/bin/review-desktop ENOENT"));
    await expect(attempt.completion).rejects.toThrow("ENOENT");
  });
});

function launcherRuntime(
  responses: Response[],
  launchDesktop: typeof launchDesktopApplication,
  read: () => Promise<ReviewDesktopDiscovery | null> = async () => discovery,
  selection?: Pick<ReviewInstanceSelection, "key" | "source">,
) {
  const fetch = vi.fn<typeof globalThis.fetch>();

  for (const response of responses) fetch.mockResolvedValueOnce(response);

  return {
    selectInstance: selectingDesktop(read, fetch, selection),
    fetch,
    focusDesktop: async () => undefined,
    launchDesktop,
    now: () => 0,
    wait: async () => undefined,
  };
}

function healthyResponse(): Response {
  return Response.json({
    ok: true,
    instanceId: discovery.instanceId,
    desktopAttached: true,
  });
}

function pendingAttempt() {
  return {
    method: 'the macOS bundle identifier "dev.fast.review"',
    completion: new Promise<never>(() => undefined),
  };
}

class FakeChild extends EventEmitter {
  readonly unref = vi.fn<() => void>();
}
