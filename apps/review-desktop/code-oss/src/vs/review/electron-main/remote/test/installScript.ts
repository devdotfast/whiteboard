/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from "node:fs";

/** packages/review/remote/install.sh, as Desktop sends it. */
export const INSTALL_SCRIPT = readFileSync(new URL("../../../../../../../../../packages/review/remote/install.sh", import.meta.url), "utf8");
