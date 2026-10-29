import {
  fontSize,
  fontWeight,
  leading,
  motion,
  radius,
  space,
  tracking,
} from "@canvas/scale.stylex";

const steps = (group: string, values: Record<string, string>) =>
  Object.entries(values).map(([step, value]) => [`${group}-${step}`, value]);

// The canvas scale a stage reads as --wb-<group>-<step>: --wb-space-12,
// --wb-radius-surface, --wb-text-body. Space steps drop their leading "s".
export const SCALE: Record<string, string> = Object.fromEntries([
  ...Object.entries(space).map(([step, value]) => [
    `space-${step.slice(1)}`,
    value,
  ]),
  ...steps("radius", radius),
  ...steps("text", fontSize),
  ...steps("leading", leading),
  ...steps("weight", fontWeight),
  ...steps("tracking", tracking),
  ...steps("motion", motion),
]);
