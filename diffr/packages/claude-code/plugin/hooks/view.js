var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/view.tsx
var locals = new WeakMap;
var at = (targets, x) => targets?.find(([from, to]) => x >= from && x < to)?.[2];
var same = (a, b) => a === b || a !== null && b !== null && a.file === b.file && a.id === b.id && a.armed === b.armed;
var DiffView = (props, surface) => {
  const frame = props;
  const { Box, Text } = surface.elements;
  let local = locals.get(surface);
  if (!local) {
    local = { instance: Math.random().toString(36).slice(2), seq: 0, pending: [] };
    locals.set(surface, local);
  }
  const state = local;
  const send = (input, hover) => {
    const { instance } = state;
    const acked = frame.acks?.[instance] ?? 0;
    state.pending = state.pending.filter(([at2]) => at2 > acked);
    if (input)
      state.pending.push([++state.seq, input]);
    const inputs = [...state.pending];
    const post = hover === undefined ? { instance, inputs } : { instance, inputs, hover };
    surface.post(post);
  };
  surface.onPointer((event) => {
    const line2 = frame.lines[event.y];
    if (event.type === "down" && event.button === "left") {
      const act = at(line2?.hits, event.x);
      if (act)
        send(event.alt ? { act, alt: true } : { act });
      else
        state.dragFrom = event.x;
    } else if (event.type === "move" && event.button === "left" && state.dragFrom !== undefined) {
      const columns = state.dragFrom - event.x;
      state.dragFrom = event.x;
      if (columns)
        send({ pan: columns });
    } else if (event.type === "up") {
      state.dragFrom = undefined;
    } else if (event.type === "move" && !event.button || event.type === "leave") {
      const hover = event.type === "leave" ? null : at(line2?.hovers, event.x) ?? null;
      if (!same(hover, frame.hover))
        send(undefined, hover);
    }
  });
  surface.onKey((press) => send({ press }));
  const line = (value) => /* @__PURE__ */ h(Text, {
    wrap: "truncate",
    color: frame.colors[frame.fg],
    backgroundColor: frame.colors[value.bg]
  }, value.segments.map(([text, fg, bg, bold]) => {
    if (fg === frame.fg && bg === value.bg && !bold)
      return text;
    const style = { color: frame.colors[fg] };
    if (bg !== value.bg)
      style.backgroundColor = frame.colors[bg];
    if (bold)
      style.bold = true;
    return /* @__PURE__ */ h(Text, {
      ...style
    }, text);
  }));
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column"
  }, frame.lines.map(line));
};
var view_default = DiffView;
export {
  view_default as default
};
