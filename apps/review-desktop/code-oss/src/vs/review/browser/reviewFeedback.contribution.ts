/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../nls.js';
import { toAction } from '../../base/common/actions.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../platform/actions/common/actions.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { IInstantiationService, type ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { INotificationService, type INotificationHandle, Severity } from '../../platform/notification/common/notification.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../platform/quickinput/common/quickInput.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../workbench/common/contributions.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { isFirstRunReloadPending } from '../common/reviewFirstRunReload.js';
import { markReviewFeedbackPrompted, readReviewFeedbackState, resetReviewFeedbackState, reviewFeedbackInstallReadyAt } from '../common/reviewFeedbackState.js';
import { IReviewDesktopConnectionService } from '../services/reviewDesktopConnectionService.js';
import { IReviewCanvasEditorTabsService } from '../services/reviewCanvasEditorTabsService.js';
import { ReviewCanvasEditorPane } from './parts/canvas/reviewCanvasPart.js';
import { ReviewCommunityContribution } from './reviewCommunity.contribution.js';

const FEEDBACK_COMMAND = 'review.feedback';

function showFeedbackInvitation(notifications: INotificationService, commands: ICommandService): INotificationHandle {
  const handle = notifications.notify({
    severity: Severity.Info,
    sticky: true,
    message: 'Hey! a note from the developers: we want to make Whiteboard work better for you. Could you fill out a short, 2-min survey to let us know how we can improve your experience?',
    actions: { primaryActionLast: true, primary: [
      toAction({ id: 'review.feedback.answer', label: 'Answer', run: () => {
        handle.close();
        return commands.executeCommand(FEEDBACK_COMMAND);
      } }),
      toAction({ id: 'review.feedback.skip', label: 'Skip', run: () => handle.close() }),
    ] },
  });
  return handle;
}

class ReviewFeedbackContribution extends Disposable {
  static readonly ID = 'workbench.contrib.devfast.reviewFeedback';

  constructor(
    @INotificationService private readonly notifications: INotificationService,
    @IStorageService private readonly storage: IStorageService,
    @IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
    @ICommandService private readonly commands: ICommandService,
    @IProductService product: IProductService,
    @IWorkbenchEnvironmentService environment: IWorkbenchEnvironmentService,
    @IInstantiationService private readonly instantiationService: IInstantiationService,
  ) {
    super();
    if (!environment.isBuilt || product.quality === 'preview') {
      this._register(registerAction2(ResetFeedbackInvitationAction));
      this._register(registerAction2(PreviewFeedbackInvitationAction));
    }
    void this.invite().catch(error => console.error('[Whiteboard] Feedback invitation check failed.', error));
  }

  private async invite(): Promise<void> {
    if (await isFirstRunReloadPending()) return;
    const { appSessionId } = await this.connection.getConnection();
    const state = readReviewFeedbackState(this.storage);
    if (state.status === 'pending' && state.lastPromptSessionId === appSessionId) return;
    const eligible = state.status === 'pending' && Date.now() >= reviewFeedbackInstallReadyAt(this.storage) && await this.connection.feedbackEligible();
    if (this._store.isDisposed) return;
    if (!eligible) {
      this.instantiationService.createInstance(ReviewCommunityContribution);
      return;
    }
    markReviewFeedbackPrompted(this.storage, appSessionId);
    const handle = showFeedbackInvitation(this.notifications, this.commands);
    this._register({ dispose: () => handle.close() });
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
    showFeedbackInvitation(notifications, commands);
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
      if (readReviewFeedbackState(storage).status === 'pending') {
        markReviewFeedbackPrompted(storage, appSessionId);
      }
      pane.showFeedback();
    }
  }
}

registerAction2(ReviewFeedbackAction);
registerWorkbenchContribution2(ReviewFeedbackContribution.ID, ReviewFeedbackContribution, WorkbenchPhase.AfterRestored);
