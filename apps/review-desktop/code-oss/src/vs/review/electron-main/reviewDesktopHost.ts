/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from "node:child_process";
import { app, BrowserWindow, powerMonitor } from "electron";
import { Disposable, toDisposable } from "../../base/common/lifecycle.js";
import { join } from "../../base/common/path.js";
import { IConfigurationService } from "../../platform/configuration/common/configuration.js";
import { IEnvironmentMainService } from "../../platform/environment/electron-main/environmentMainService.js";
import {
  ILifecycleMainService,
  LifecycleMainPhase,
} from "../../platform/lifecycle/electron-main/lifecycleMainService.js";
import { ILogService } from "../../platform/log/common/log.js";
import { IProductService } from "../../platform/product/common/productService.js";
import { getResolvedShellEnv } from "../../platform/shell/node/shellEnv.js";
import { IApplicationStorageMainService } from "../../platform/storage/electron-main/storageMainService.js";
import { NullTelemetryService } from "../../platform/telemetry/common/telemetryUtils.js";
import { IUpdateService } from "../../platform/update/common/update.js";
import { UtilityProcess } from "../../platform/utilityProcess/electron-main/utilityProcess.js";
import type { ReviewDesktopConnection } from "../common/reviewDesktopBootstrap.js";
import type { ReviewGatewayHostState } from "../common/reviewProtocol.js";
import {
  REVIEW_REMOTE_HOSTS_ENABLED_SETTING,
  REVIEW_REMOTE_HOSTS_SETTING,
  REVIEW_REMOTE_INSTALL_MODES,
  REVIEW_REMOTE_INSTALL_SETTING,
  REVIEW_TELEMETRY_SETTING,
} from "../common/reviewConfigurationDefaults.js";
import {
  REVIEW_REMOTE_INSTALL_NO,
  REVIEW_REMOTE_INSTALL_YES,
} from "../common/reviewRemoteInstallPrompt.js";
import { remoteHostAliases } from "../common/reviewSshAlias.js";
import { REVIEW_CRASH_DUMPS_DIRNAME } from "../node/reviewCrashReporter.js";
import { ReviewCrashDumps } from "./reviewCrashDumps.js";
import { ReviewCrashTelemetry } from "./reviewCrashTelemetry.js";
import { ReviewMainErrorTelemetry } from "./reviewMainErrorTelemetry.js";
import { reviewEnabledExtensionGroups } from "./remote/reviewEnabledExtensionGroups.js";
import {
  remoteArtifacts,
  reviewRemoteCacheDirectory,
} from "./remote/reviewRemoteArtifacts.js";
import type {
  ReviewRemoteInstallFlow,
  ReviewRemoteInstallMode,
} from "./remote/reviewRemoteHost.js";
import { ReviewRemoteHosts } from "./remote/reviewRemoteHosts.js";
import {
  openRemoteInstallConsent,
  reviewRemoteInstallConsentPath,
} from "./remote/reviewRemoteInstallConsent.js";
import { installRemote } from "./remote/reviewRemoteInstaller.js";
import { createSshAskpass } from "./remote/reviewSshAskpass.js";
import {
  reviewSshConfigPath,
  reviewSshControlDirectory,
} from "./remote/reviewSshCommand.js";
import { listSshAliases } from "./remote/reviewSshConfigAliases.js";
import {
  reviewRemoteInstallPromptRelay,
  reviewSshPromptRelay,
} from "./remote/reviewSshPromptRelay.js";
import { ReviewServerSupervisor } from "./reviewServerSupervisor.js";
import {
  darwinShipItLogPath,
  ReviewUpdateTelemetry,
} from "./reviewUpdateTelemetry.js";

/**
 * Binds the embedded Review server's lifetime to the application's. All of the
 * supervision logic lives in `ReviewServerSupervisor`, which holds no Electron
 * dependency so it stays testable; this class only supplies the platform.
 */
export class ReviewDesktopHost extends Disposable {
  private readonly supervisor: ReviewServerSupervisor;
  private remoteHosts: ReviewRemoteHosts | undefined;
  private terminating = false;
  private disposed = false;

  private readonly onTerminationSignal = () => {
    if (this.terminating) return;
    this.terminating = true;
    void this.lifecycleMainService.kill(0);
  };

  constructor(
    @IConfigurationService
    private readonly configurationService: IConfigurationService,
    @ILogService private readonly logService: ILogService,
    @ILifecycleMainService
    private readonly lifecycleMainService: ILifecycleMainService,
    @IEnvironmentMainService
    private readonly environmentMainService: IEnvironmentMainService,
    @IProductService private readonly productService: IProductService,
    @IUpdateService private readonly updateService: IUpdateService,
    @IApplicationStorageMainService
    private readonly applicationStorageMainService: IApplicationStorageMainService,
  ) {
    super();
    let resolvedEnvironment: Promise<NodeJS.ProcessEnv> | undefined;
    const shellEnvironment = () =>
      (resolvedEnvironment ??= getResolvedShellEnv(
        this.configurationService,
        this.logService,
        this.environmentMainService.args,
        process.env,
      ));
    let crashTelemetry: ReviewCrashTelemetry | undefined;
    let errorTelemetry: ReviewMainErrorTelemetry | undefined;
    const crashDumpsDir = join(
      this.environmentMainService.userDataPath,
      REVIEW_CRASH_DUMPS_DIRNAME,
    );
    this.supervisor = this._register(
      new ReviewServerSupervisor({
        appRoot: this.environmentMainService.appRoot,
        channel: !this.environmentMainService.isBuilt
          ? "dev"
          : this.productService.quality === "preview"
            ? "preview"
            : "stable",
        isBuilt: this.environmentMainService.isBuilt,
        userExtensionsPath: this.environmentMainService.extensionsPath,
        appVersion:
          this.productService.reviewVersion ?? this.productService.version,
        appUrlProtocol: this.productService.urlProtocol,
        releaseChannel: this.productService.quality,
        serverEntryOverride: process.env["DEV_FAST_REVIEW_SERVER_ENTRY"],
        resolveEnvironment: shellEnvironment,
        logInfo: (message) => this.logService.info(message),
        logError: (message) => this.logService.error(message),
        createProcess: () =>
          new UtilityProcess(
            this.logService,
            NullTelemetryService,
            this.lifecycleMainService,
          ),
        telemetryEnabled:
          this.configurationService.getValue<boolean>(REVIEW_TELEMETRY_SETTING) !==
          false,
        crashDumpsDir,
        onServerTerminated: (detail) => {
          errorTelemetry?.serverLost();
          crashTelemetry?.reportServerExit(detail);
        },
        onServerReady: () => errorTelemetry?.serverReady(),
        onRemoteHostRestarted: (alias) => this.remoteHosts?.reattach(alias),
      }),
    );
    this._register(
      this.configurationService.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(REVIEW_TELEMETRY_SETTING)) return;
        this.supervisor.setTelemetryEnabled(
          this.configurationService.getValue<boolean>(
            REVIEW_TELEMETRY_SETTING,
          ) !== false,
        );
      }),
    );
    this._register(
      this.lifecycleMainService.onWillShutdown((event) => {
        event.join("reviewDesktopHost", this.supervisor.stop());
        if (this.remoteHosts)
          event.join("reviewRemoteHosts", this.remoteHosts.dispose());
      }),
    );
    void this.lifecycleMainService
      .when(LifecycleMainPhase.AfterWindowOpen)
      .then(() => this.startRemoteHosts(shellEnvironment));
    // Main-process errors report through the embedded server, so they pass the
    // same opt-out checks and the same redaction step as every other event.
    errorTelemetry = new ReviewMainErrorTelemetry({
      whenConnected: () => this.whenConnected(),
      isTelemetryEnabled: () =>
        this.configurationService.getValue<boolean>(REVIEW_TELEMETRY_SETTING) !==
        false,
      userDataPath: this.environmentMainService.userDataPath,
      logError: (message) => this.logService.error(message),
    });
    const mainTelemetry = errorTelemetry;
    this._register(toDisposable(() => mainTelemetry.dispose()));
    const crashDumps = new ReviewCrashDumps({
      dumpsDir: crashDumpsDir,
      launch: {
        startedAt: Date.now(),
        appSessionId: this.supervisor.appSessionId,
        appVersion:
          this.productService.reviewVersion ?? this.productService.version,
      },
      whenConnected: () => this.whenConnected(),
      isTelemetryEnabled: () =>
        this.configurationService.getValue<boolean>(REVIEW_TELEMETRY_SETTING) !==
        false,
      logError: (message) => this.logService.error(message),
    });
    crashTelemetry = this._register(
      new ReviewCrashTelemetry({
        app,
        windows: BrowserWindow.getAllWindows(),
        capture: (name, properties, onDelivered) =>
          mainTelemetry.capture(name, properties, undefined, onDelivered),
        onCrashRecorded: (at) => crashDumps.recordLiveCrash(at),
      }),
    );
    crashDumps.reconcile().catch((error) =>
      this.logService.error(`[Review Desktop] crash dump reconcile failed: ${error}`),
    );
    this._register(
      new ReviewUpdateTelemetry({
        updateService: this.updateService,
        storageService: this.applicationStorageMainService,
        telemetry: mainTelemetry,
        isTelemetryEnabled: () =>
          this.configurationService.getValue<boolean>(
            REVIEW_TELEMETRY_SETTING,
          ) !== false,
        shipItLogPath: this.productService.darwinBundleIdentifier
          ? darwinShipItLogPath(
              this.environmentMainService.userHome.fsPath,
              this.productService.darwinBundleIdentifier,
            )
          : undefined,
        logError: (message) => this.logService.error(message),
      }),
    );
    process.once("SIGINT", this.onTerminationSignal);
    process.once("SIGTERM", this.onTerminationSignal);
    this.supervisor.start();
  }

  /**
   * Resolves once the embedded server has announced a validated endpoint. The
   * renderer awaits this instead of reading bootstrap environment variables.
   */
  whenConnected(): Promise<ReviewDesktopConnection> {
    return this.supervisor.whenConnected();
  }

  stageRustAnalyzer(): void {
    this.supervisor.stageRustAnalyzer();
  }

  listSshAliases(): Promise<string[]> {
    return listSshAliases(reviewSshConfigPath());
  }

  retryRemoteHost(alias: string): void {
    this.remoteHosts?.retry(alias);
  }

  async getRemoteLanguageEndpoint(serverId: string) {
    const manager = this.remoteHosts;
    if (!manager) return undefined;
    try {
      const { url, token } = await this.whenConnected();
      const response = await fetch(new URL("/remote-hosts", url), {
        headers: { "x-review-token": token },
      });
      if (!response.ok) return undefined;
      return await manager.languageEndpoint(
        serverId,
        (await response.json()) as ReviewGatewayHostState[],
      );
    } catch {
      return undefined;
    }
  }

  installRemoteHost(alias: string): Promise<void> {
    return this.remoteHosts?.install(alias) ?? Promise.resolve();
  }

  private remoteInstallFlow(): ReviewRemoteInstallFlow {
    const { userDataPath, isBuilt, appRoot } = this.environmentMainService;
    const cacheDirectory = reviewRemoteCacheDirectory(userDataPath);
    return {
      mode: () => {
        const mode = this.configurationService.getValue(
          REVIEW_REMOTE_INSTALL_SETTING,
        );
        return REVIEW_REMOTE_INSTALL_MODES.includes(
          mode as ReviewRemoteInstallMode,
        )
          ? (mode as ReviewRemoteInstallMode)
          : "ask";
      },
      consent: openRemoteInstallConsent(
        reviewRemoteInstallConsentPath(userDataPath),
      ),
      confirm: async (request) => {
        const answer = await reviewRemoteInstallPromptRelay.prompt({
          ...request,
          kind: "confirm",
        });
        return answer === REVIEW_REMOTE_INSTALL_YES
          ? true
          : answer === REVIEW_REMOTE_INSTALL_NO
            ? false
            : undefined;
      },
      run: async (input) => {
        const pin = this.productService.whiteboardRemote;
        const artifacts = await remoteArtifacts(input.target, {
          pin,
          checkout: isBuilt ? undefined : join(appRoot, "..", "..", ".."),
          cacheDirectory,
        });
        return installRemote({
          ...input,
          artifacts,
          published: pin !== undefined,
          cacheDirectory,
        });
      },
    };
  }

  private startRemoteHosts(
    shellEnvironment: () => Promise<NodeJS.ProcessEnv>,
  ): void {
    if (this.disposed) return;
    let version: Promise<string> | undefined;
    const manager = new ReviewRemoteHosts({
      spawn: (args, options) => spawn("ssh", args, options),
      controlDirectory: reviewSshControlDirectory(),
      instance: this.environmentMainService.userDataPath,
      environment: async () => ({
        ...process.env,
        ...(await shellEnvironment().catch(() => ({}))),
      }),
      createAskpass: (input) => createSshAskpass(input),
      prompt: (request) => reviewSshPromptRelay.prompt(request),
      desktopVersion: () => (version ??= this.desktopVersion()),
      desktopCommit: this.productService.commit,
      groups: () =>
        reviewEnabledExtensionGroups(this.environmentMainService.extensionsPath),
      send: (hosts) => this.supervisor.setRemoteHosts(hosts),
      log: (message) => this.logService.info(`[Remote hosts] ${message}`),
      install: this.remoteInstallFlow(),
    });
    this.remoteHosts = manager;
    const update = () => {
      manager.update(
        this.configurationService.getValue(
          REVIEW_REMOTE_HOSTS_ENABLED_SETTING,
        ) === true,
        remoteHostAliases(
          this.configurationService.getValue(REVIEW_REMOTE_HOSTS_SETTING),
        ),
      );
    };
    const onResume = () => manager.resume();
    const onExit = () => manager.killNow();
    powerMonitor.on("resume", onResume);
    process.once("exit", onExit);
    this._register(
      toDisposable(() => {
        powerMonitor.off("resume", onResume);
        process.off("exit", onExit);
        void manager.dispose();
      }),
    );
    this._register(
      this.configurationService.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(REVIEW_REMOTE_HOSTS_SETTING) ||
          event.affectsConfiguration(REVIEW_REMOTE_HOSTS_ENABLED_SETTING) ||
          event.affectsConfiguration(REVIEW_REMOTE_INSTALL_SETTING)
        )
          update();
      }),
    );
    update();
  }

  private async desktopVersion(): Promise<string> {
    const fallback =
      this.productService.reviewVersion ?? this.productService.version;
    try {
      const { url } = await this.whenConnected();
      const response = await fetch(new URL("/health", url));
      const { version } = (await response.json()) as { version?: unknown };
      return typeof version === "string" ? version : fallback;
    } catch {
      return fallback;
    }
  }

  override dispose(): void {
    this.disposed = true;
    process.off("SIGINT", this.onTerminationSignal);
    process.off("SIGTERM", this.onTerminationSignal);
    super.dispose();
  }
}
