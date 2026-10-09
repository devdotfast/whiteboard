import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, TuiAltScreen, type Component, type Terminal } from "@earendil-works/pi-tui";

export function terminalHost() {
  let receive = (_data: string) => {};
  const terminal: Terminal = {
    columns: 180, rows: 40, kittyProtocolActive: false,
    start(input) { receive = input; }, stop() {}, async drainInput() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
  const root = new Container();
  const widgets = new Container();
  const theme = { borderColor: (s: string) => s, selectList: {
    selectedPrefix: (s: string) => s, selectedText: (s: string) => s,
    description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s,
  } };
  const keys = { matches: () => false } as unknown as ConstructorParameters<typeof CustomEditor>[2];
  const editor = new CustomEditor(tui, theme, keys);
  editor.setText("Keep my draft.");
  let submitted = 0;
  editor.onSubmit = () => { submitted++; };
  root.addChild(widgets); root.addChild(editor);
  tui.setLayoutRoot(root); tui.setFocus(editor); tui.start();
  let widget: Component | undefined;
  const ui = {
    notify() {},
    setWidget(_name: string, factory: ((tui: TuiAltScreen) => Component) | undefined) {
      widgets.clear(); widget = factory?.(tui);
      if (widget) widgets.addChild(widget);
      tui.renderNow();
    },
    onTerminalInput: tui.addInputListener.bind(tui),
    getEditorText: () => editor.getExpandedText(),
    pasteToEditor(text: string) { editor.handleInput(`\x1b[200~${text}\x1b[201~`); },
  } as unknown as ExtensionContext["ui"];
  const input = (data: string) => { receive(data); tui.renderNow(); };
  const mouse = (button: number, x: number, y: number, release = false) => input(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`);
  return { ui, tui, editor, terminal, input, mouse,
    click(x: number, y: number) { mouse(0, x, y); mouse(0, x, y, true); },
    get widget() { return widget; }, get submitted() { return submitted; },
    stop() { tui.stop(); },
  };
}
