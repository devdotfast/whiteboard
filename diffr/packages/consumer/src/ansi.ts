import type { Frame } from "./protocol";

function rgb(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Expected an RGB pane colour: ${value}`);
  return [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16)).join(";");
}

/** Pi consumes ANSI lines; other hosts can paint the same segments directly. */
export function ansiLines(frame: Frame): string[] {
  const colors = frame.colors.map(rgb);
  return frame.lines.map(line => line.segments.map(([text, fg, bg, bold]) =>
    `\x1b[0;38;2;${colors[fg]};48;2;${colors[bg]}${bold ? ";1" : ""}m${text}`,
  ).join("") + "\x1b[0m");
}
