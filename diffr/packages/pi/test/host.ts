import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

type InputHandler = Parameters<ExtensionContext["ui"]["onTerminalInput"]>[0];
export function host(draft = "Keep my draft.") {
  const terminal = { columns: 180, rows: 40 };
  let overlay = false;
  let focused: Component | null = null;
  const tui = { terminal, requestRender() {}, hasOverlay: () => overlay,
    getFocusedComponent: () => focused,
    setFocus(value: Component | null) {
      if (focused && "focused" in focused) (focused as any).focused = false;
      focused = value;
      if (value && "focused" in value) (value as any).focused = true;
    },
  } as unknown as TUI;
  const theme = { borderColor: (s: string) => s, selectList: {
    selectedPrefix: (s: string) => s, selectedText: (s: string) => s,
    description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s,
  } };
  const keys = { matches: () => false } as unknown as ConstructorParameters<typeof CustomEditor>[2];
  const editor = new CustomEditor(tui, theme, keys);
  editor.setText(draft);
  tui.setFocus(editor);
  let submitted = 0;
  editor.onSubmit = () => { submitted++; };
  let widget: Component | undefined;
  const handlers = new Set<InputHandler>();
  const ui = {
    notify() {},
    setWidget(_name: string, factory: ((tui: TUI) => Component) | undefined) { widget = factory?.(tui); },
    onTerminalInput(handler: InputHandler) { handlers.add(handler); return () => { handlers.delete(handler); }; },
    getEditorText: () => editor.getExpandedText(),
    setEditorText: (text: string) => editor.setText(text),
    pasteToEditor(text: string) { editor.handleInput(`\x1b[200~${text}\x1b[201~`); },
  } as unknown as ExtensionContext["ui"];
  return { ui, terminal, editor, get widget() { return widget; },
    get submitted() { return submitted; }, set overlay(value: boolean) { overlay = value; tui.setFocus(value ? { render: () => [], invalidate() {} } : editor); },
    input(data: string) {
      for (const handler of handlers) if (handler(data)?.consume) return;
      focused?.handleInput?.(data);
    },
  };
}
