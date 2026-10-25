import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import test from 'node:test';
import { observableValue } from '../../base/common/observable.js';
import type { IWorkbenchUIElementFactory } from '../../editor/browser/widget/multiDiffEditor/workbenchUIElementFactory.js';
import type { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const dom = new JSDOM('<html><body></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'MutationObserver', 'Element', 'navigator', 'customElements', 'UIEvent', 'MouseEvent', 'KeyboardEvent'] as const) {
	Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
registerHooks({ load(url, context, next) {
	return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
} });
const { MultiDiffEditorResourceHeader } = await import('../../editor/browser/widget/multiDiffEditor/multiDiffEditorResourceHeader.js');

for (const wholeHeader of [false, true]) {
	test(`file chevron owns collapse and keyboard state (whole-header opt-in: ${wholeHeader})`, () => {
		const container = document.createElement('div');
		document.body.append(container);
		const collapsed = observableValue<boolean | undefined>('collapsed', false);
		let toggles = 0;
		let bubbled = 0;
		container.addEventListener('click', () => bubbled++);
		const services = { dispose() {}, createInstance: () => ({ dispose() {} }) };
		const header = new MultiDiffEditorResourceHeader(container, {
			headerClickToCollapse: wholeHeader,
		} satisfies IWorkbenchUIElementFactory, collapsed, () => {
			toggles++;
			collapsed.set(!collapsed.get(), undefined);
		}, { createChild: () => services } as unknown as IInstantiationService,
		{ createScoped: () => ({ dispose() {} }) } as unknown as IContextKeyService);
		try {
			const chevron = header.element.querySelector<HTMLElement>('.collapse-button [role="button"]')!;
			assert.equal(chevron.getAttribute('aria-label'), 'Collapse file');
			assert.equal(chevron.getAttribute('aria-expanded'), 'true');
			assert.equal(header.element.getAttribute('role'), wholeHeader ? 'button' : null);
			assert.equal(header.element.hasAttribute('tabindex'), wholeHeader);
			for (const target of [header.element, header.element.querySelector<HTMLElement>('.file-path')!, header.element.querySelector<HTMLElement>('.header-metadata')!]) target.click();
			assert.equal(toggles, wholeHeader ? 3 : 0);
			const before = toggles;
			const previousBubbles = bubbled;
			chevron.click();
			assert.equal(toggles, before + 1);
			assert.equal(bubbled, previousBubbles);
			for (const [key, keyCode] of [['Enter', 13], [' ', 32]] as const) {
				const previous: number = toggles;
				chevron.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
				assert.equal(toggles, previous + 1);
				assert.equal(chevron.getAttribute('aria-expanded'), String(!collapsed.get()));
			}
			header.setCollapseLocked(true);
			const previous: number = toggles;
			chevron.click();
			chevron.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
			assert.equal(toggles, previous);
			assert.equal(chevron.getAttribute('aria-disabled'), 'true');
			header.setCollapseLocked(false);
			chevron.click();
			assert.equal(toggles, previous + 1);
		} finally {
			header.dispose();
			container.remove();
		}
	});
}
