import type { ClientModule, ClientSurface, JsonValue, RenderElement } from "claude-code";
import type { Target } from "@diffr/viewer/viewport/cell";
import type { Hover } from "@diffr/viewer/viewer";
import type { Frame, Input, Line, Post } from "./protocol";

interface Local {
  instance: string;
  seq: number;
  pending: [number, Input][];
}

/** Keyed by surface, which outlives redraws, so inputs between redraws are not lost. */
const locals = new WeakMap<ClientSurface<unknown>, Local>();

const at = <T,>(targets: Target<T>[] | undefined, x: number) =>
  targets?.find(([from, to]) => x >= from && x < to)?.[2];

const same = (a: Hover | null, b: Hover | null) => JSON.stringify(a) === JSON.stringify(b);

const DiffView: ClientModule = (props, surface) => {
  const frame = props as unknown as Frame;
  const { Box, Text } = surface.elements;
  let local = locals.get(surface);
  if (!local) {
    local = { instance: Math.random().toString(36).slice(2), seq: 0, pending: [] };
    locals.set(surface, local);
  }
  const state = local;
  const send = (input: Input | undefined, hover?: Hover | null) => {
    const { instance } = state;
    const acked = frame.acks[instance] ?? 0;
    state.pending = state.pending.filter(([at]) => at > acked);
    if (input) state.pending.push([++state.seq, input]);
    const inputs = [...state.pending];
    const post: Post = hover === undefined ? { instance, inputs } : { instance, inputs, hover };
    surface.post(post as unknown as JsonValue);
  };
  // Listeners are set on every draw so they always read the frame on screen.
  surface.onPointer((event) => {
    const line = frame.lines[event.y];
    // Lines past this band's own reach the hooks module by their place in the whole frame.
    const y = frame.offset + event.y;
    if (event.type === "down" && event.button === "left") {
      const act = at(line?.hits, event.x);
      if (act) send(event.alt ? { act, alt: true } : { act });
      else send({ select: { x: event.x, y } });
    } else if (event.type === "move" && event.button === "left") {
      send({ select: { x: event.x, y, extend: true } });
    } else if ((event.type === "move" && !event.button) || event.type === "leave") {
      const hover = event.type === "leave" ? null : (at(line?.hovers, event.x) ?? null);
      if (!same(hover, frame.hover)) send(undefined, hover);
    }
  });
  surface.onKey((press) => send({ press }));
  // Default-styled runs are bare strings, to stay under Claude Code's per-instance tree cap.
  const line = (value: Line): RenderElement => (
    <Text wrap="truncate" color={frame.colors[frame.fg]} backgroundColor={frame.colors[value.bg]}>
      {value.segments.map(([text, fg, bg, bold]) => {
        if (fg === frame.fg && bg === value.bg && !bold) return text;
        const style: { color: string; backgroundColor?: string; bold?: true } = { color: frame.colors[fg]! };
        if (bg !== value.bg) style.backgroundColor = frame.colors[bg];
        if (bold) style.bold = true;
        return <Text {...style}>{text}</Text>;
      })}
    </Text>
  );
  return <Box flexDirection="column">{frame.lines.map(line)}</Box>;
};
export default DiffView;
