import { observableValue } from "vs/base/common/observable.js";

/** Shared by live editors and the mobile display menu. */
export const showLineNumbers = observableValue("showLineNumbers", true);

export const mobileWordWrap = observableValue("mobileWordWrap", false);
