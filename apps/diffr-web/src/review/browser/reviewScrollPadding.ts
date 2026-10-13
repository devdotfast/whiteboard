import { isMacintosh } from "vs/base/common/platform.js";

// Leave room to scroll the last item above an auto-hidden macOS Dock.
export const reviewBottomScrollPadding = isMacintosh ? 128 : 0;
