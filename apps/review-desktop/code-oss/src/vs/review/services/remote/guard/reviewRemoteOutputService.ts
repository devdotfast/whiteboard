/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, type UriComponents } from "../../../../base/common/uri.js";
import { IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { MainThreadOutputService } from "../../../../workbench/api/browser/mainThreadOutputService.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { IOutputService } from "../../../../workbench/services/output/common/output.js";
import { IStatusbarService } from "../../../../workbench/services/statusbar/browser/statusbar.js";
import { IViewsService } from "../../../../workbench/services/views/common/viewsService.js";
import { IReviewRemoteRefusals, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * Upstream's output peer registers a channel on any file into the window's
 * channel registry, and the window then reads and watches that file. For a
 * remote host, only its own files.
 */
export class ReviewRemoteOutputService extends MainThreadOutputService {
	constructor(
		extHostContext: IExtHostContext,
		@IOutputService outputService: IOutputService,
		@IViewsService viewsService: IViewsService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStatusbarService statusbarService: IStatusbarService,
		@IReviewRemoteRefusals private readonly refusals: ReviewRemoteRefusals,
	) {
		super(extHostContext, outputService, viewsService, configurationService, statusbarService);
	}

	override async $register(label: string, file: UriComponents, languageId: string | undefined, extensionId: string): Promise<string> {
		if (!this.refusals.owns(URI.revive(file))) throw this.refusals.refuse("output channels on files outside this remote");
		return super.$register(label, file, languageId, extensionId);
	}
}
