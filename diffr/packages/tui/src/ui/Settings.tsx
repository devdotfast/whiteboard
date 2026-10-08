/** A searchable, grouped settings screen over diffr's config schema; every change writes through the CLI. */
import { useReducer, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/react";
import {
  filterSettings,
  formatValue,
  isDefault,
  parseValue,
  withValues,
  type ConfigClient,
  type Setting,
} from "../diffr/config";
import { dark } from "../diffr/theme";
import { sliceTextByWidth } from "./lib/text";

const fit = (text: string, width: number) => sliceTextByWidth(text, 0, Math.max(0, width)).text;
const pad = (text: string, width: number) => fit(text, width).padEnd(Math.max(0, width));
/** Schema descriptions keep their source line breaks; the screen shows them as one line. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");
/** Word-wrap a description into lines of at most `width` cells, keeping at most `max` lines. */
export function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of oneLine(text).split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length > max ? [...lines.slice(0, max - 1), fit(lines.slice(max - 1).join(" "), width - 1) + "…"] : lines;
}

/** Keys that look like credentials are typed masked and shown only as stored or not. */
export const isSecret = (key: string) => /(api_key|secret|token|password)/i.test(key);

/** The value column: secrets never show their text, and an unset value says so. */
export const displayValue = (setting: Setting) => {
  const text = formatValue(setting.value);
  if (isSecret(setting.key)) return text === "" ? "not set" : "✓ stored";
  return text === "" ? "not set" : text;
};

/** Booleans and enums change in place; everything else needs typed input. */
const toggles = (setting: Setting) => setting.type === "boolean" || setting.type === "enum";

/** The value a toggle moves to next: booleans flip, enums cycle through their options. */
export function nextValue(setting: Setting): string {
  if (setting.type === "boolean") return setting.value === true ? "false" : "true";
  const options = setting.options!;
  return options[(options.indexOf(formatValue(setting.value)) + 1) % options.length];
}

interface Prompt {
  setting: Setting;
  draft: string;
  error: string;
}

interface ScreenState {
  settings: Setting[];
  query: string;
  cursor: number;
  prompt: Prompt | null;
  status: { text: string; error: boolean } | null;
}

type Line = { kind: "gap"; group: string } | { kind: "group"; group: string } | { kind: "setting"; setting: Setting; index: number };

export function Settings({
  client,
  initial,
  onQuit,
  initialQuery = "",
}: {
  client: ConfigClient;
  initial: Setting[];
  onQuit: () => void;
  initialQuery?: string;
}) {
  const { width, height } = useTerminalDimensions();
  // Keys can arrive in one burst before React re-renders (a fast typist, a paste followed by
  // enter), so the handlers read and write this ref and only then ask for a render.
  const state = useRef<ScreenState>({
    settings: initial,
    query: initialQuery,
    cursor: 0,
    prompt: null,
    status: null,
  });
  const [, render] = useReducer((n: number) => n + 1, 0);
  const update = (change: Partial<ScreenState>) => {
    state.current = { ...state.current, ...change };
    render();
  };
  const { settings, query, prompt, status } = state.current;
  const visible = filterSettings(settings, query);
  const selected = Math.min(state.current.cursor, Math.max(0, visible.length - 1));
  const current = visible[selected];
  const theme = dark;

  /** Write through the CLI first, then reread every value: a change can move
   *  others, such as a default that follows the provider. */
  const save = (setting: Setting, text: string) => {
    const value = parseValue(setting, text);
    client.set(setting.key, text);
    update({
      settings: withValues(state.current.settings, client.show()),
      status: { text: `${setting.title}: ${displayValue({ ...setting, value })}`, error: false },
    });
  };
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const type = (text: string) => {
    const { prompt, query } = state.current;
    if (prompt) update({ prompt: { ...prompt, draft: prompt.draft + text, error: "" } });
    else update({ query: query + text, cursor: 0 });
  };

  useKeyboard((key) => {
    const { prompt, query, settings, cursor } = state.current;
    if (prompt) {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) update({ prompt: null });
      else if (key.name === "return") {
        try {
          save(prompt.setting, prompt.draft);
          update({ prompt: null });
        } catch (error) {
          update({ prompt: { ...prompt, error: message(error) } });
        }
      } else if (key.name === "backspace") update({ prompt: { ...prompt, draft: prompt.draft.slice(0, -1), error: "" } });
      else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) type(key.sequence);
      return;
    }
    const matches = filterSettings(settings, query);
    const at = Math.min(cursor, Math.max(0, matches.length - 1));
    const here = matches[at];
    if (key.name === "escape" || (key.ctrl && key.name === "c")) onQuit();
    else if (key.name === "down" || (key.ctrl && key.name === "n")) update({ cursor: Math.min(at + 1, matches.length - 1) });
    else if (key.name === "up" || (key.ctrl && key.name === "p")) update({ cursor: Math.max(at - 1, 0) });
    else if ((key.name === "return" || key.name === "space") && here) {
      if (toggles(here)) {
        try {
          save(here, nextValue(here));
        } catch (error) {
          update({ status: { text: message(error), error: true } });
        }
      } else update({ prompt: { setting: here, draft: isSecret(here.key) ? "" : formatValue(here.value), error: "" } });
    } else if (key.name === "backspace") update({ query: query.slice(0, -1), cursor: 0 });
    else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) type(key.sequence);
  });
  // A pasted value arrives as one event; line breaks around it are not part of the value.
  usePaste((event) => type(new TextDecoder().decode(event.bytes).replace(/[\r\n]+/g, "")));

  const rule = <text height={1} fg={theme.accent} selectable={false}>{"─".repeat(width)}</text>;
  const blank = (id: string) => <text key={id} height={1} selectable={false}>{" "}</text>;

  if (prompt) {
    const { setting, draft, error } = prompt;
    const field = isSecret(setting.key) ? "•".repeat(draft.length) : draft;
    return (
      <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
        <box flexGrow={1} />
        {rule}
        {blank("top")}
        <text height={1} fg={theme.accent} attributes={TextAttributes.BOLD} selectable={false}>{fit(` ${setting.title}`, width)}</text>
        {blank("title")}
        {wrap(setting.description, width - 2, 3).map((text, i) => (
          <text key={`description:${i}`} height={1} fg={theme.fg} selectable={false}>{` ${text}`}</text>
        ))}
        <box height={1} flexDirection="row">
          <text fg={theme.fg} selectable={false}>{"> "}</text>
          <text fg={theme.fg} selectable={false}>{fit(field, width - 3)}</text>
          <text fg={theme.bg} bg={theme.fg} selectable={false}>{" "}</text>
        </box>
        {error
          ? <text height={1} fg={theme.deletion} selectable={false}>{fit(` ${error}`, width)}</text>
          : <box height={1} flexDirection="row">
              <text fg={theme.fg} selectable={false}>{" ("}</text>
              <text fg={theme.muted} selectable={false}>{"escape/ctrl+c"}</text>
              <text fg={theme.fg} selectable={false}>{" to cancel, "}</text>
              <text fg={theme.muted} selectable={false}>{"enter"}</text>
              <text fg={theme.fg} selectable={false}>{" to submit)"}</text>
            </box>}
        {blank("bottom")}
        {rule}
      </box>
    );
  }

  const lines: Line[] = [];
  visible.forEach((setting, index) => {
    if (setting.group !== visible[index - 1]?.group) {
      if (index > 0) lines.push({ kind: "gap", group: setting.group });
      lines.push({ kind: "group", group: setting.group });
    }
    lines.push({ kind: "setting", setting, index });
  });
  // Two rules, search, blank, count, blank, up to three detail lines, status, hint.
  const listHeight = Math.max(3, height - 11);
  const cursorLine = lines.findIndex((line) => line.kind === "setting" && line.index === selected);
  // Keep the selected row's group heading on screen with it where possible.
  const start = Math.max(0, Math.min(cursorLine - Math.floor(listHeight / 2), lines.length - listHeight));
  const shown = lines.slice(start, start + listHeight);
  // A heading whose rows are cut off below says nothing; drop it with its gap.
  while (shown.length && shown.at(-1)!.kind !== "setting") shown.pop();
  // The arrow gutter, the longest title, then a two-cell gap before values.
  const titleWidth = Math.min(width - 16, 3 + Math.max(...settings.map((s) => s.title.length)) + 2);
  const valueWidth = Math.max(8, width - titleWidth - 4);
  const detail = current
    ? `${current.key} · default ${displayValue({ ...current, value: current.default })}`
    : "";

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      {rule}
      <box height={1} flexDirection="row">
        <text fg={theme.fg} selectable={false}>{"> "}</text>
        <text fg={theme.fg} selectable={false}>{fit(query, width - 3)}</text>
        <text fg={theme.bg} bg={theme.fg} selectable={false}>{" "}</text>
      </box>
      {blank("search")}
      {shown.map((line) => {
        if (line.kind === "gap") return blank(`gap:${line.group}`);
        if (line.kind === "group")
          return (
            <text key={`group:${line.group}`} height={1} fg={theme.fg} attributes={TextAttributes.BOLD} selectable={false}>
              {fit(` ${line.group}`, width)}
            </text>
          );
        const { setting, index } = line;
        const isSelected = index === selected;
        const changed = !isDefault(setting);
        return (
          <box key={setting.key} height={1} flexDirection="row">
            <text fg={isSelected ? theme.accent : theme.fg} selectable={false}>
              {pad(fit(`${isSelected ? " → " : "   "}${setting.title}`, titleWidth - 2), titleWidth)}
            </text>
            <text fg={isSelected ? theme.accent : changed ? theme.fg : theme.muted} selectable={false}>
              {fit(displayValue(setting), valueWidth)}
            </text>
          </box>
        );
      })}
      {visible.length === 0 && <text height={1} fg={theme.muted} selectable={false}>{"   No settings match"}</text>}
      <text height={1} fg={theme.muted} selectable={false}>
        {fit(`   (${visible.length ? selected + 1 : 0}/${visible.length})`, width)}
      </text>
      {blank("count")}
      {wrap(current?.description ?? "", width - 4, 2).map((text, i) => (
        <text key={`description:${i}`} height={1} fg={theme.muted} selectable={false}>{`   ${text}`}</text>
      ))}
      <text height={1} fg={theme.muted} selectable={false}>{fit(`   ${detail}`, width)}</text>
      <box flexGrow={1} />
      <text height={1} fg={status?.error ? theme.deletion : theme.addition} selectable={false}>{fit(`   ${status?.text ?? ""}`, width)}</text>
      <text height={1} fg={theme.muted} selectable={false}>{fit("   Type to search · Enter/Space to change · Esc to quit", width)}</text>
      {rule}
    </box>
  );
}
