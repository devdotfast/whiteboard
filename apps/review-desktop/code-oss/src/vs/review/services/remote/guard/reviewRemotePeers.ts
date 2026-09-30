/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../../base/common/lifecycle.js";
import { IInstantiationService } from "../../../../platform/instantiation/common/instantiation.js";
import { MainContext } from "../../../../workbench/api/common/extHost.protocol.js";
import { extHostCustomer, type IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteCommands } from "./reviewRemoteCommandService.js";
import { ReviewRemoteOutputService } from "./reviewRemoteOutputService.js";

/**
 * Two upstream peers write into window-wide registries, not through a
 * service, so a guarded service cannot reach them. For a remote host this
 * customer, which the manager creates after every named peer, puts guarded
 * peers in their place; the upstream instances are then never called. The
 * window's own extension host keeps upstream's.
 */
@extHostCustomer
export class ReviewRemoteGuardedPeers extends Disposable {
	constructor(context: IExtHostContext, @IInstantiationService instantiationService: IInstantiationService) {
		super();
		if (!context.remoteAuthority?.startsWith("whiteboard+")) return;
		context.set(MainContext.MainThreadCommands, this._register(instantiationService.createInstance(ReviewRemoteCommands, context)));
		context.set(MainContext.MainThreadOutputService, this._register(instantiationService.createInstance(ReviewRemoteOutputService, context)));
	}
}
