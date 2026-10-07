import { type StructuralDiffEvent, StructuralDiffEventSchema } from "./contract.js";

export function decodeStructuralDiffEvent(line: string): StructuralDiffEvent {
  try {
    return StructuralDiffEventSchema.parse(JSON.parse(line));
  } catch (cause) {
    throw new Error("Malformed diffr protocol record.", { cause });
  }
}
