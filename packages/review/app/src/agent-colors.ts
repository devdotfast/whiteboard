import * as stylex from "@stylexjs/stylex";

/** Recolors an agent's pill, courier and editing ring: the accent and its
 * washes become that agent's. The first agent keeps the accent itself. */
const colors = stylex.create({
  violet: {
    "--accent": "var(--agent-1)",
    "--marker-tint": "var(--agent-1-tint)",
    "--marker-glow": "var(--agent-1-glow)",
  },
  teal: {
    "--accent": "var(--agent-2)",
    "--marker-tint": "var(--agent-2-tint)",
    "--marker-glow": "var(--agent-2-glow)",
  },
});

/** The color of the agent in this slot; slots past the palette repeat it. */
export function agentColor(slot: number | undefined) {
  if (slot === undefined) return null;

  return [null, colors.violet, colors.teal][slot % 3] ?? null;
}
