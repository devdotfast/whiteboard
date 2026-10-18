/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../nls.js';
import { toAction } from '../../base/common/actions.js';
import { RunOnceScheduler, Throttler } from '../../base/common/async.js';
import { Disposable, MutableDisposable } from '../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../platform/actions/common/actions.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import type { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../platform/dialogs/common/dialogs.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { INotificationService, type INotificationHandle, Severity } from '../../platform/notification/common/notification.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../platform/quickinput/common/quickInput.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { isFirstRunReloadPending } from '../common/reviewFirstRunReload.js';
import { markReviewFeedbackPrompted, readReviewFeedbackState, resetReviewFeedbackState, reviewFeedbackInstallReadyAt } from '../common/reviewFeedbackState.js';
import { markReviewInvitationOffered, nextReviewInvitation, readReviewInvitationState, updateReviewInvitationState } from '../common/reviewInvitationState.js';
import { IReviewApiCatalogService } from '../services/reviewApiCatalogService.js';
import { IReviewTelemetryService } from '../services/reviewTelemetryService.js';
import { IReviewDesktopConnectionService } from '../services/reviewDesktopConnectionService.js';
import { IReviewCanvasEditorTabsService } from '../services/reviewCanvasEditorTabsService.js';
import { ReviewCanvasEditorPane } from './parts/canvas/reviewCanvasPart.js';
import { ReviewCanvasEditorInput } from './parts/canvas/reviewCanvasEditorInput.js';
import { REVIEW_DISCORD_URL } from '../common/reviewProtocol.js';

const FEEDBACK_COMMAND = 'review.feedback';
const EMAIL_COMMAND = 'review.shareEmail';

function showInvitation(kind: 'email' | 'feedback', notifications: INotificationService, commands: ICommandService): INotificationHandle {
  const command = kind === 'email' ? EMAIL_COMMAND : FEEDBACK_COMMAND;
  const handle = notifications.notify({
    severity: Severity.Info,
    sticky: true,
    message: kind === 'email'
      ? 'A note from the developers: we’d love to get in touch to hear feedback on how to make Whiteboard better for you.'
      : 'Hey! a note from the developers: we want to make Whiteboard work better for you. Could you fill out a short, 2-min survey to let us know how we can improve your experience?',
    actions: { primaryActionLast: true, primary: [
      toAction({ id: `${command}.accept`, label: kind === 'email' ? 'Sure' : 'Answer', run: () => {
        handle.close();
        return commands.executeCommand(command);
      } }),
      toAction({ id: `${command}.skip`, label: 'Skip', run: () => handle.close() }),
    ] },
  });
  return handle;
}

class ReviewInvitationsContribution extends Disposable {
  static readonly ID = 'workbench.contrib.devfast.reviewFeedback';
  private readonly invitation = this._register(new MutableDisposable());
  private readonly checks = this._register(new Throttler());
  private readonly check = this._register(new RunOnceScheduler(() => {
    void this.checks.queue(() => this.invite()).catch(error => console.error('[Whiteboard] Invitation check failed.', error));
  }, 300));
  private initialBoardCount: number | undefined;
  private nativeDialogOpen = false;

  constructor(
    @INotificationService private readonly notifications: INotificationService,
    @IStorageService private readonly storage: IStorageService,
    @IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
    @ICommandService private readonly commands: ICommandService,
    @IProductService product: IProductService,
    @IWorkbenchEnvironmentService environment: IWorkbenchEnvironmentService,
    @IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
    @IEditorService private readonly editors: IEditorService,
    @IHostService private readonly host: IHostService,
    @IDialogService private readonly dialogs: IDialogService,
    @IOpenerService private readonly opener: IOpenerService,
    @IReviewTelemetryService private readonly telemetry: IReviewTelemetryService,
  ) {
    super();
    if (!environment.isBuilt || product.quality === 'preview') {
      this._register(registerAction2(ResetFeedbackInvitationAction));
      this._register(registerAction2(PreviewFeedbackInvitationAction));
      this._register(registerAction2(PreviewEmailInvitationAction));
    }
    this._register(this.editors.onDidActiveEditorChange(() => {
      if (!this.onHome()) this.invitation.clear();
      this.check.schedule();
    }));
    this._register(this.catalog.onDidChange(() => this.check.schedule()));
    this._register(this.host.onDidChangeFocus(() => this.check.schedule()));
    this._register(this.dialogs.onWillShowDialog(() => { this.nativeDialogOpen = true; }));
    this._register(this.dialogs.onDidShowDialog(() => { this.nativeDialogOpen = false; this.check.schedule(); }));
    this._register(this.commands.onWillExecuteCommand(event => {
      if (event.commandId === EMAIL_COMMAND || event.commandId === FEEDBACK_COMMAND) this.invitation.clear();
    }));
    this.check.schedule();
  }

  private onHome(): boolean {
    const input = this.editors.activeEditor;
    return input instanceof ReviewCanvasEditorInput && input.target.kind === 'home';
  }

  private async invite(): Promise<void> {
    if (await isFirstRunReloadPending()) return;
    const { appSessionId } = await this.connection.getConnection();
    await this.catalog.initialize();
    this.initialBoardCount ??= this.catalog.reviews.filter(review => review.kind !== 'scratchpad' && !review.trashedAt).length;
    if (this._store.isDisposed || !this.host.hasFocus) return;
    const input = this.editors.activeEditor;
    const state = readReviewInvitationState(this.storage);
    if (state.email === 'onboarding' && input instanceof ReviewCanvasEditorInput && input.target.kind === 'api') {
      const id = input.target.reviewId;
      const board = this.catalog.reviews.find(review => review.reviewId === id);
      if (board && board.kind !== 'scratchpad' && !board.trashedAt && !board.working && board.version > 0) {
        updateReviewInvitationState(this.storage, { email: 'pending' });
      }
    }
    if (!this.canInvite()) return;
    const feedback = readReviewFeedbackState(this.storage);
    const eligible = feedback.status === 'pending' && Date.now() >= reviewFeedbackInstallReadyAt(this.storage) && await this.connection.feedbackEligible();
    if (!this.canInvite()) return;
    // Eligibility retires the earlier email ask even during a cooldown.
    if ((eligible || feedback.status === 'submitted') && readReviewInvitationState(this.storage).email === 'pending') {
      updateReviewInvitationState(this.storage, { email: 'retired' });
    }
    const next = nextReviewInvitation(readReviewInvitationState(this.storage), {
      now: Date.now(), sessionId: appSessionId,
      feedbackEligible: eligible, feedback: readReviewFeedbackState(this.storage), initialBoardCount: this.initialBoardCount,
    });
    if (!next) return;
    markReviewInvitationOffered(this.storage, next, appSessionId);
    if (next === 'discord') {
      await this.inviteToDiscord();
    } else {
      if (next === 'feedback') markReviewFeedbackPrompted(this.storage, appSessionId);
      const handle = showInvitation(next, this.notifications, this.commands);
      this.invitation.value = { dispose: () => handle.close() };
    }
  }

  private canInvite(): boolean {
    const pane = this.editors.activeEditorPane;
    return !this._store.isDisposed && this.host.hasFocus && this.onHome() &&
      !this.nativeDialogOpen && pane instanceof ReviewCanvasEditorPane && !pane.isDialogOpen();
  }

  private async inviteToDiscord(): Promise<void> {
    this.telemetry.capture('discord_dialog_shown');
    const result = await this.dialogs.confirm({
      type: 'info',
      message: 'Join the Whiteboard community',
      detail: 'Meet the team, ask questions, and share feedback in the /dev/fast Discord. You can also join anytime using the Discord link next to Report a bug.',
      primaryButton: 'Join Discord',
      cancelButton: 'Not now',
    });
    if (result.confirmed) {
      this.telemetry.capture('discord_clicked', { via: 'dialog' });
      await this.opener.open(REVIEW_DISCORD_URL, { openExternal: true });
    } else {
      this.telemetry.capture('discord_dialog_dismissed');
    }
  }
}

class PreviewEmailInvitationAction extends Action2 {
  constructor() {
    super({ id: 'review.email.previewInvitation', title: localize2('review.email.previewInvitation', 'Preview Email Invitation'), category: localize2('review.email.developer', 'Developer'), f1: true });
  }
  async run(accessor: ServicesAccessor): Promise<void> {
    const quickInput = accessor.get(IQuickInputService);
    const notifications = accessor.get(INotificationService);
    const commands = accessor.get(ICommandService);
    await quickInput.cancel();
    showInvitation('email', notifications, commands);
  }
}

class ReviewEmailAction extends Action2 {
  constructor() {
    super({ id: EMAIL_COMMAND, title: localize2('review.shareEmail', 'Share Contact Email with Whiteboard'), f1: true });
  }
  async run(accessor: ServicesAccessor): Promise<void> {
    const storage = accessor.get(IStorageService);
    const quickInput = accessor.get(IQuickInputService);
    const tabs = accessor.get(IReviewCanvasEditorTabsService);
    const editors = accessor.get(IEditorService);
    const connection = accessor.get(IReviewDesktopConnectionService);
    await quickInput.cancel();
    await tabs.openHome(true);
    const pane = editors.activeEditorPane;
    if (pane instanceof ReviewCanvasEditorPane && !pane.isDialogOpen()) {
      const { appSessionId } = await connection.getConnection();
      markReviewInvitationOffered(storage, 'email', appSessionId);
      pane.showEmail();
    }
  }
}

class PreviewFeedbackInvitationAction extends Action2 {
  constructor() {
    super({
      id: 'review.feedback.previewInvitation',
      title: localize2('review.feedback.previewInvitation', 'Preview Feedback Invitation'),
      category: localize2('review.feedback.developer', 'Developer'),
      f1: true,
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const notifications = accessor.get(INotificationService);
    const commands = accessor.get(ICommandService);
    const quickInput = accessor.get(IQuickInputService);
    await quickInput.cancel();
    showInvitation('feedback', notifications, commands);
  }
}

class ResetFeedbackInvitationAction extends Action2 {
  constructor() {
    super({
      id: 'review.feedback.resetInvitation',
      title: localize2('review.feedback.resetInvitation', 'Reset Feedback Invitation'),
      category: localize2('review.feedback.developer', 'Developer'),
      f1: true,
    });
  }

  run(accessor: ServicesAccessor): void {
    const storage = accessor.get(IStorageService);
    resetReviewFeedbackState(storage);
    accessor.get(INotificationService).info('Restart Whiteboard');
  }
}

class ReviewFeedbackAction extends Action2 {
  constructor() {
    super({ id: FEEDBACK_COMMAND, title: localize2('review.feedback', 'Give Whiteboard Feedback'), f1: true });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const editors = accessor.get(IEditorService);
    const tabs = accessor.get(IReviewCanvasEditorTabsService);
    const quickInput = accessor.get(IQuickInputService);
    const connection = accessor.get(IReviewDesktopConnectionService);
    const storage = accessor.get(IStorageService);
    await quickInput.cancel();
    if (!(editors.activeEditorPane instanceof ReviewCanvasEditorPane)) {
      await tabs.openHome(true);
    }
    const pane = editors.activeEditorPane;
    if (pane instanceof ReviewCanvasEditorPane) {
      const { appSessionId } = await connection.getConnection();
      markReviewInvitationOffered(storage, 'feedback', appSessionId);
      if (readReviewFeedbackState(storage).status === 'pending') {
        markReviewFeedbackPrompted(storage, appSessionId);
      }
      pane.showFeedback();
    }
  }
}

registerAction2(ReviewFeedbackAction);
registerAction2(ReviewEmailAction);
registerWorkbenchContribution2(ReviewInvitationsContribution.ID, ReviewInvitationsContribution, WorkbenchPhase.AfterRestored);
