/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../../base/common/lifecycle.js";
import { IInstantiationService } from "../../../../platform/instantiation/common/instantiation.js";
import { MainContext } from "../../../../workbench/api/common/extHost.protocol.js";
import { extHostCustomer, type IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import type { ProxyIdentifier } from "../../../../workbench/services/extensions/common/proxyIdentifier.js";
import { ReviewRemoteCommands } from "./reviewRemoteCommandService.js";
import { ReviewRemoteOutputService } from "./reviewRemoteOutputService.js";
import { ReviewRemoteQuickOpen } from "./reviewRemoteQuickOpen.js";
import { ReviewRemoteTextEditors } from "./reviewRemoteTextEditors.js";
import { ReviewRemoteTreeViews } from "./reviewRemoteTreeViews.js";

/**
 * Some upstream peers write into window-wide registries, or hand the window
 * text through a private path, so a guarded service cannot reach them. For a
 * remote host this customer, which the manager creates after every named
 * peer, puts guarded peers in their place; the upstream instances are then
 * never called. The window's own extension host keeps upstream's.
 */
@extHostCustomer
export class ReviewRemoteGuardedPeers extends Disposable {
	constructor(context: IExtHostContext, @IInstantiationService instantiationService: IInstantiationService) {
		super();
		if (!context.remoteAuthority?.startsWith("whiteboard+")) return;
		context.set(MainContext.MainThreadCommands, this._register(instantiationService.createInstance(ReviewRemoteCommands, context)));
		context.set(MainContext.MainThreadOutputService, this._register(instantiationService.createInstance(ReviewRemoteOutputService, context)));
		context.set(MainContext.MainThreadQuickOpen, this._register(instantiationService.createInstance(ReviewRemoteQuickOpen, context)));
		context.set(MainContext.MainThreadTreeViews, this._register(instantiationService.createInstance(ReviewRemoteTreeViews, context)));
		// The documents-and-editors customer sets upstream's editor peer itself, unnamed like this one, so
		// in either order: this host's later sets of that peer keep the guarded one.
		const editors = this._register(instantiationService.createInstance(ReviewRemoteTextEditors, context));
		const set = context.set.bind(context);
		context.set = ((identifier: ProxyIdentifier<unknown>, instance: unknown) =>
			set(identifier, identifier === MainContext.MainThreadTextEditors ? editors : instance)) as IExtHostContext["set"];
		context.set(MainContext.MainThreadTextEditors, editors);
	}
}
