/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import type { BoxRenderable, KeyEvent, MouseEvent, Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { openComparison, type Comparison } from "@diffr/consumer/process";
import { opened } from "@diffr/consumer/open-tool";
import { receiveOpen, type OpenRequest } from "./bridge";
import { PointerInput } from "@diffr/consumer/pointer";
import { terminalKey } from "@diffr/consumer/key";
import type { Outcome } from "@diffr/consumer/frame";
import type { Input } from "@diffr/consumer/protocol";

const tui: TuiPlugin = async (api, options) => {
  const [comparison, setComparison] = createSignal<Comparison>();
  const [full, setFull] = createSignal(false);
  const [sidebar, setSidebar] = createSignal(false);
  const [session, setSession] = createSignal<string>();
  let generation = 0;
  let captureFocus = true;
  let previousFocus: Renderable | null = null;
  let view: BoxRenderable | undefined;
  const currentSession = () => api.route.current.name === "session" && "params" in api.route.current
    ? api.route.current.params?.sessionID as string | undefined : undefined;
  const restoreFocus = () => { if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus(); };
  const close = () => {
    generation++;
    comparison()?.dispose();
    setComparison(undefined);
    setFull(false);
    restoreFocus();
  };
  const error = (value: unknown) => api.ui.toast({ variant: "error", message: `Diffr: ${value instanceof Error ? value.message : value}` });
  // The command palette restores its own focus after run() returns.
  const focusPane = () => { setTimeout(() => view?.focus(), 0); };
  const toggle = () => { captureFocus = true; setFull(value => !value); };
  const outcome = async (value: Outcome) => {
    const current = comparison();
    if (!current) return;
    if (value.close) return close();
    if (value.chat) {
      // appendPrompt addresses the mounted prompt. Never send to a different session.
      if (currentSession() !== session()) { error("Return to the session that opened this comparison before adding to its draft."); return; }
      try {
        await api.client.tui.appendPrompt({ text: `\n${value.chat.map(chip => chip.context).join("\n\n")}\n` }, { throwOnError: true });
        current.pane.chatted(value.chat.map(chip => chip.name));
        setFull(false);
        restoreFocus();
      } catch (cause) { error(cause); }
    }
    if (value.copy) {
      const copied = api.renderer.copyToClipboardOSC52(value.copy.text);
      current.pane.copied(value.copy.what, copied ? undefined : "Terminal clipboard unavailable");
    }
  };
  async function open(fullscreen = false, request?: OpenRequest, signal?: AbortSignal): Promise<string> {
    if (request && request.sessionID !== currentSession()) throw new Error("Return to the session that requested Diffr.");
    close();
    const id = generation;
    try {
      if (!currentSession()) {
        const result = await api.client.session.create({}, { throwOnError: true });
        if (id !== generation) throw new Error("Diffr open was replaced or closed.");
        api.route.navigate("session", { sessionID: result.data!.id });
      }
      setSession(currentSession());
      captureFocus = !request;
      previousFocus = api.renderer.currentFocusedRenderable;
      const config = options as { input?: string; binary?: string; args?: string[] } | undefined;
      const next = await openComparison({ cwd: api.state.path.directory, input: config?.input,
        binary: config?.binary, args: request?.args ?? config?.args });
      if (id !== generation || (request && request.sessionID !== currentSession())) { next.dispose(); throw new Error("Diffr session changed during open."); }
      setFull(fullscreen);
      setComparison(next);
      const result = await opened(next, signal);
      if (id !== generation || currentSession() !== session()) throw new Error("Diffr session changed during open.");
      return result;
    } catch (cause) { if (id === generation) close(); throw cause; }
  }

  function View(props: { full: boolean; current: Comparison }) {
    const dimensions = useTerminalDimensions();
    const [width, setWidth] = createSignal(props.full ? dimensions().width : 37);
    const [revision, setRevision] = createSignal(0);
    const refresh = () => setRevision(n => n + 1);
    const dispatch = (input: Input) => {
      const value = props.current.pane.input(input);
      // Pane-local selection, help, and messages do not emit Viewer notifications.
      refresh();
      void outcome(value).catch(error).finally(refresh);
    };
    const rows = () => Math.max(4, props.full ? dimensions().height - 1 : Math.floor(dimensions().height * 0.5));
    let box!: BoxRenderable;
    const pointer = new PointerInput();
    const frame = createMemo(() => {
      revision();
      return props.current.pane.frame({ columns: Math.max(1, width()), rows: rows() });
    });
    onMount(() => { view = box; box.focusable = true; if (captureFocus) box.focus(); });
    onCleanup(props.current.pane.subscribe(refresh));
    onCleanup(() => { pointer.reset(); if (view === box) view = undefined; });
    const mouse = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      const x = event.x - box.x;
      const y = event.y - box.y - 1;
      if (event.type === "down") {
        if (event.button !== 0) return;
        if (!box.focused) previousFocus = api.renderer.currentFocusedRenderable;
        box.focus();
        if (y < 0) { toggle(); return; }
      }
      if (event.type === "scroll") {
        props.current.pane.scroll((event.scroll?.direction === "up" ? -1 : 1) * (event.scroll?.delta ?? 1), x);
        refresh();
        return;
      }
      // Child text nodes emit out/over while a drag crosses rows; only a release ends it.
      const type = event.type === "drag-end" ? "up" : event.type;
      if (type !== "down" && type !== "drag" && type !== "up" && type !== "move") return;
      const next = pointer.read(frame(), { type, x, y, alt: event.modifiers.alt });
      if (next.hover !== undefined) props.current.pane.hover(next.hover);
      if (next.input) dispatch(next.input);
    };
    const key = (event: KeyEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.eventType === "release") return;
      if (event.name === "f6") { toggle(); return; }
      if (event.name === "escape") {
        pointer.reset(); props.current.pane.blur();
        refresh();
        if (props.full && !sidebar()) close();
        else { setFull(false); restoreFocus(); }
        return;
      }
      dispatch({ press: terminalKey(event) });
    };
    return <box ref={box} width="100%" height={rows() + 1} flexShrink={0} flexDirection="column"
      backgroundColor={api.theme.current.background} onSizeChange={() => setWidth(box.width)}
      onKeyDown={key} onMouse={mouse}>
      <text height={1} wrapMode="none">{props.full ? "Split view" : "Full screen"} · F6 · esc chat</text>
      <For each={frame().lines}>{line => <text height={1} flexShrink={0} wrapMode="none" selectable={false}>
        <For each={line.segments}>{segment => <span style={{ fg: frame().colors[segment[1]], bg: frame().colors[segment[2]], bold: !!segment[3] }}>{segment[0]}</span>}</For>
      </text>}</For>
    </box>;
  }
  function Sidebar(props: { sessionID: string }) {
    onMount(() => setSidebar(true));
    onCleanup(() => setSidebar(false));
    return <Show when={session() === props.sessionID && !full() ? comparison() : undefined} keyed>{current => <View full={false} current={current} />}</Show>;
  }
  function Overlay() {
    const size = useTerminalDimensions();
    const visible = () => currentSession() === session() && (full() || !sidebar()) ? comparison() : undefined;
    return <Show when={visible()} keyed>{current => <box position="absolute" left={0} top={0} zIndex={2500}
      width={size().width} height={size().height}><View full current={current} /></box>}</Show>;
  }
  api.slots.register({ order: 0, slots: {
    sidebar_content: (_ctx, props) => <Sidebar sessionID={props.session_id} />,
    app: () => <Overlay />,
  } });
  api.keymap.registerLayer({ commands: [
    { name: "diffr.open", namespace: "palette", title: "Open Diffr beside chat", slashName: "diffr", run: () => { void open().catch(error); } },
    { name: "diffr.fullscreen", namespace: "palette", title: "Toggle Diffr fullscreen", slashName: "diffr-fullscreen", run: () => { if (comparison()) { toggle(); focusPane(); } else void open(true).catch(error); } },
    { name: "diffr.focus", namespace: "palette", title: "Focus Diffr", slashName: "diffr-focus", run: focusPane },
    { name: "diffr.close", namespace: "palette", title: "Close Diffr", slashName: "diffr-close", run: close },
  ] });
  const stop = api.event.on("tui.command.execute", event => {
    void receiveOpen(event.properties.command, api.state.path.directory, currentSession,
      (request, signal) => open(false, request, signal), api.lifecycle.signal).catch(error);
  });
  api.lifecycle.onDispose(() => { stop(); close(); });
};

export default { id: "diffr", tui };
