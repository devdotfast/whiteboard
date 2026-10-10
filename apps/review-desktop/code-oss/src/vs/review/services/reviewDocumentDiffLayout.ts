import type { IDisposable } from "../../base/common/lifecycle.js";
import {
	autorun,
	observableFromEvent,
	type IObservable,
} from "../../base/common/observable.js";
import type { ReviewDiffLayoutSetting } from "./reviewDiffLayout.js";

export interface DocumentDiffLayoutItem {
	readonly isDiffUpToDate: IObservable<boolean>;
	readonly diff: IObservable<
		{ identical: boolean; quitEarly: boolean } | undefined
	>;
}

/** Only completed, identical document comparisons override the user's layout. */
export function bindDocumentDiffLayout(
	layout: ReviewDiffLayoutSetting,
	items: IObservable<readonly (DocumentDiffLayoutItem | undefined)[]>,
	setRenderSideBySide: (split: boolean) => void,
): IDisposable {
	const preference = observableFromEvent(layout.onDidChange, () =>
		layout.get(),
	);
	return autorun((reader) => {
		const current = items.read(reader);
		const identical =
			current.length > 0 &&
			current.every((item) => {
				if (!item) return false;
				const upToDate = item.isDiffUpToDate.read(reader);
				const diff = item.diff.read(reader);
				return upToDate && diff?.identical === true && !diff.quitEarly;
			});
		setRenderSideBySide(preference.read(reader) === "split" && !identical);
	});
}
