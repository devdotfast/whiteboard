/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import { TextareaRenderable } from "@opentui/core";
import { Diffr } from "./rpc";
import type { BoxRenderable, KeyEvent, MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { openComparison, type Comparison } from "@diffr/consumer/process";
import { opened } from "@diffr/consumer/open-tool";
import { receiveOpen, type OpenRequest } from "./bridge";
import { PointerInput } from "@diffr/consumer/pointer";
import { terminalKey } from "@diffr/consumer/key";
import type { Outcome } from "@diffr/consumer/frame";
import type { Input } from "@diffr/consumer/protocol";

export default Plugin.define({ id: "diffr", async setup(api) {
  const options = api.options;
  const lifecycle = new AbortController();
  const [comparison, setComparison] = createSignal<Comparison>();

  const [session, setSession] = createSignal<string>();
  let generation = 0;
  let draft: TextareaRenderable | undefined;
  let panel: PanelInput | undefined;
  let view: BoxRenderable | undefined;
  const currentSession = () => {
    const route = api.ui.router.current();
    return route.type === "session" ? route.sessionID : undefined;
  };
  const returnToChat = () => {
    if (panel?.presentation === "fullscreen") api.ui.panel.close();
    else api.keymap.dispatch("pane.focus.left");
    if (currentSession() === session() && draft && !draft.isDestroyed) draft.focus();
  };
  const close = () => {
    generation++;
    api.ui.panel.close();
    comparison()?.dispose();
    setComparison(undefined);
    returnToChat();
    draft = undefined;
  };
  const error = (value: unknown) => api.ui.toast.show({ variant: "error", message: `Diffr: ${value instanceof Error ? value.message : value}` });
  const focusPane = () => { panel?.focus(); queueMicrotask(() => view?.focus()); };
  const toggle = () => panel?.toggleFullscreen();
  const outcome = async (value: Outcome) => {
    const current = comparison();
    if (!current) return;
    if (value.close) return close();
    if (value.chat) {
      // Only write to the public editor captured from the originating session.
      if (currentSession() !== session()) { error("Return to the session that opened this comparison before adding to its draft."); return; }
      try {
        if (!draft || draft.isDestroyed) throw new Error("Focus the chat draft and reopen Diffr before adding selected code.");
        draft.gotoBufferEnd();
        draft.insertText(`\n${value.chat.map(chip => chip.context).join("\n\n")}\n`);
        current.pane.chatted(value.chat.map(chip => chip.name));
        returnToChat();
      } catch (cause) { error(cause); }
    }
    if (value.copy) {
      const copied = api.renderer.copyToClipboardOSC52(value.copy.text);
      current.pane.copied(value.copy.what, copied ? undefined : "Terminal clipboard unavailable");
    }
  };
  async function open(fullscreen = false, request?: OpenRequest, signal?: AbortSignal): Promise<string> {
    if (request && request.sessionID !== currentSession()) throw new Error("Return to the session that requested Diffr.");
    api.ui.dialog.clear();
    if (!currentSession()) throw new Error("Open a chat session before opening Diffr.");
    // Allow a command palette to restore its native focus before capturing the editor.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (request && request.sessionID !== currentSession()) throw new Error("Diffr session changed during open.");
    if (api.ui.panel.current()) returnToChat();
    const editor = api.renderer.currentFocusedRenderable;
    const saved = editor instanceof TextareaRenderable ? editor : session() === currentSession() ? draft : undefined;
    close();
    draft = saved;
    const id = generation;
    setSession(currentSession());
    try {
      const config = options as { input?: string; binary?: string; args?: string[] };
      const next = await openComparison({ cwd: (api.location ?? api.data.location.default()).directory,
        input: config.input, binary: config.binary, args: request?.args ?? config.args });
      if (id !== generation || currentSession() !== session()) { next.dispose(); throw new Error("Diffr session changed during open."); }
      setComparison(next);
      if (!api.ui.panel.open("diffr.review", { presentation: fullscreen ? "fullscreen" : "panel" })) throw new Error("A visible chat session is required.");
      if (request && panel?.presentation !== "fullscreen") api.keymap.dispatch("pane.focus.left");
      const result = await opened(next, signal);
      if (id !== generation || currentSession() !== session()) throw new Error("Diffr session changed during open.");
      return result;
    } catch (cause) { if (id === generation) close(); throw cause; }
  }

  function View(props: { panel: PanelInput; current: Comparison }) {
    const dimensions = useTerminalDimensions();
    const [height, setHeight] = createSignal(dimensions().height);
    const [revision, setRevision] = createSignal(0);
    const refresh = () => setRevision(n => n + 1);
    const dispatch = (input: Input) => {
      const value = props.current.pane.input(input);
      // Pane-local selection, help, and messages do not emit Viewer notifications.
      refresh();
      void outcome(value).catch(error).finally(refresh);
    };
    const rows = () => Math.max(1, height() - 1);
    let box!: BoxRenderable;
    const pointer = new PointerInput();
    const frame = createMemo(() => {
      revision();
      return props.current.pane.frame({ columns: Math.max(1, props.panel.width), rows: rows() });
    });
    panel = props.panel;
    createEffect(() => {
      props.panel.presentation;
      if (props.panel.focused) queueMicrotask(() => {
        if (props.panel.focused && box && !box.isDestroyed) { view = box; box.focus(); }
      });
    });
    onCleanup(props.current.pane.subscribe(refresh));
    onCleanup(() => { pointer.reset(); if (panel === props.panel) { panel = undefined; view = undefined; } });
    const mouse = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      const x = event.x - box.x;
      const y = event.y - box.y - 1;
      if (event.type === "down") {
        if (event.button !== 0) return;
        props.panel.focus();
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
        returnToChat();
        return;
      }
      dispatch({ press: terminalKey(event) });
    };
    return <box ref={box} width="100%" height="100%" focusable flexGrow={1} flexDirection="column"
      backgroundColor={api.theme.background.base} onSizeChange={() => setHeight(box.height)}
      onKeyDown={key} onMouse={mouse}>
      <text height={1} wrapMode="none">{props.panel.presentation === "fullscreen" ? "Split view" : "Full screen"} · F6 · esc chat</text>
      <For each={frame().lines}>{line => <text height={1} flexShrink={0} wrapMode="none" selectable={false}>
        <For each={line.segments}>{segment => <span style={{ fg: frame().colors[segment[1]], bg: frame().colors[segment[2]], bold: !!segment[3] }}>{segment[0]}</span>}</For>
      </text>}</For>
    </box>;
  }
  api.ui.slot({ append: "session.panel", render: panel =>
    <Show when={panel.name === "diffr.review" && panel.sessionID === session() ? comparison() : undefined} keyed>
      {current => <View panel={panel} current={current} />}
    </Show>,
  });
  const show = (fullscreen = false) => {
    api.ui.dialog.clear();
    if (comparison() && session() === currentSession()) {
      api.ui.panel.open("diffr.review", { presentation: fullscreen ? "fullscreen" : "panel" });
      return;
    }
    void open(fullscreen).catch(error);
  };
  api.keymap.layer(() => ({ mode: "global", commands: [
    { id: "diffr.open", title: "Open Diffr beside chat", palette: true, slash: { name: "diffr" }, run: () => show() },
    { id: "diffr.fullscreen", title: "Toggle Diffr fullscreen", palette: true, slash: { name: "diffr-fullscreen" }, run: () => { api.ui.dialog.clear(); if (panel) toggle(); else show(true); } },
    { id: "diffr.focus", title: "Focus Diffr", palette: true, slash: { name: "diffr-focus" }, bind: "f7", run: () => { api.ui.dialog.clear(); if (panel) focusPane(); else show(); } },
    { id: "diffr.close", title: "Close Diffr", palette: true, slash: { name: "diffr-close" }, run: close },
  ] }));
  const stop = api.client.rpc(Diffr).events.on("open", event => {
    const data = event.data as { command: string };
    void receiveOpen(data.command, (api.location ?? api.data.location.default()).directory, currentSession,
      (request, signal) => open(false, request, signal), lifecycle.signal).catch(error);
  });
  return () => { lifecycle.abort(); stop(); close(); };
} });
