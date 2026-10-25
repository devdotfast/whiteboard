import { agentColor } from "@canvas/agent-colors";
import type { MotionPhase } from "@canvas/draw-queue";
import { drawStyles } from "@canvas/draw-styles";
import type { StyleArg } from "@canvas/stylex-props";
import * as stylex from "@stylexjs/stylex";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { nodes } from "./schema";
import { REMOTE } from "./structure";

// An agent's edits draw on an edited board as on the read-only page: a
// block's motion phase marks its element, the block the agent is writing
// wears its ring, a retitled section's heading recomposes, and a block the
// agent removed is erased in place before it goes.

/** The block an agent is writing in, while it is. */
export interface EditingRegion {
  id: string;
  writing: boolean;
  slot?: number;
}

/** A removed block's last look, drawn where it was while it is erased. */
interface Ghost {
  id: string;
  pos: number;
  dom: HTMLElement;
  /** The element's own classes, before any phase's. */
  classes: string;
  since: number;
}

interface MotionState {
  phases: Map<string, MotionPhase>;
  region: EditingRegion | null;
  ghosts: Ghost[];
  decorations: DecorationSet;
}

export const motionKey = new PluginKey<MotionState>("boardMotion");

/** How long a removed block waits for its erase to begin. */
const GHOST_WAIT_MS = 1_500;

const className = (...styles: StyleArg[]) =>
  stylex.props(...styles).className ?? "";

const phaseClass = (phase: MotionPhase) =>
  className(
    phase === "queued" && drawStyles.queued,
    phase === "landing" && [drawStyles.landing, drawStyles.blockLand],
    phase === "rewriting" && drawStyles.rewriting,
    phase === "retitle" && drawStyles.retitle,
    phase === "erasing" && [drawStyles.erasing, drawStyles.blockCollapse],
  );

const regionClass = (region: "writing" | "idle" | "off", slot?: number) =>
  className(
    drawStyles.region,
    region !== "off" && drawStyles.regionOn,
    region !== "off" && agentColor(slot),
    region === "writing" && drawStyles.blockPulse,
  );

/** A ghost lives while its erase is queued or drawing, or briefly while it
 * waits for one. */
const alive = (ghost: Ghost, phases: Map<string, MotionPhase>, now: number) => {
  const phase = phases.get(ghost.id);

  return (
    phase === "erasing" ||
    phase === "queued" ||
    (!phase && now - ghost.since < GHOST_WAIT_MS)
  );
};

/** Ghosts for the blocks another author's version just removed, cut from
 * the page as it still shows them. */
export function captureRemoved(view: EditorView, tr: Transaction): Ghost[] {
  if (!tr.getMeta(REMOTE) || !tr.docChanged) return [];
  const kept = new Set<string>();

  tr.doc.forEach((node) => {
    if (node.attrs.id) kept.add(node.attrs.id);
  });

  const ghosts: Ghost[] = [];

  tr.before.forEach((node, pos, index) => {
    const id: string | null = node.attrs.id;

    if (index === 0 || !id || kept.has(id)) return;
    const dom = view.nodeDOM(pos);

    if (!(dom instanceof HTMLElement)) return;
    // SAFETY: cloning an element yields an element of the same kind.
    const copy = dom.cloneNode(true) as HTMLElement;

    copy.contentEditable = "false";
    copy.setAttribute("aria-hidden", "true");
    ghosts.push({
      id,
      pos: tr.mapping.map(pos, -1),
      dom: copy,
      classes: copy.className,
      since: Date.now(),
    });
  });

  return ghosts;
}

function draw(
  doc: PMNode,
  { phases, region, ghosts }: Omit<MotionState, "decorations">,
): DecorationSet {
  if (!phases.size && !region && !ghosts.length) return DecorationSet.empty;
  const found: Decoration[] = [];

  doc.forEach((node, pos, index) => {
    if (index === 0 || node.type === nodes.atom) return;
    const id: string | null = node.attrs.id;
    const phase = id ? phases.get(id) : undefined;

    const ring = region
      ? region.id === id
        ? region.writing
          ? "writing"
          : "idle"
        : "off"
      : undefined;

    if (!phase && !ring) return;

    // ProseMirror writes an undefined attribute as the text "undefined".
    const attrs = Object.fromEntries(
      Object.entries({
        class: [
          phase && phaseClass(phase),
          ring && regionClass(ring, region?.slot),
        ]
          .filter(Boolean)
          .join(" "),
        "data-motion": phase,
        "data-region": ring,
      }).filter(([, value]) => value !== undefined),
    );

    found.push(
      Decoration.node(pos, pos + node.nodeSize, attrs, { phase, ring }),
    );
  });

  for (const ghost of ghosts) {
    const phase = phases.get(ghost.id) ?? "queued";

    found.push(
      Decoration.widget(
        ghost.pos,
        () => {
          ghost.dom.dataset.motion = phase;
          ghost.dom.className = `${ghost.classes} ${phaseClass(phase)}`;

          return ghost.dom;
        },
        {
          key: `ghost:${ghost.id}:${phase}`,
          side: -1,
          ignoreSelection: true,
        },
      ),
    );
  }

  return DecorationSet.create(doc, found);
}

export const motion = () =>
  new Plugin<MotionState>({
    key: motionKey,
    state: {
      init: () => ({
        phases: new Map(),
        region: null,
        ghosts: [],
        decorations: DecorationSet.empty,
      }),
      apply(tr, value) {
        const meta: Partial<MotionState> | undefined = tr.getMeta(motionKey);
        const next = { ...value, ...meta };
        const now = Date.now();

        next.ghosts = [...value.ghosts, ...(meta?.ghosts ?? [])].flatMap(
          (ghost) => {
            const moved = { ...ghost, pos: tr.mapping.map(ghost.pos, -1) };

            return alive(moved, next.phases, now) ? [moved] : [];
          },
        );

        // Rebuilt on a phase, region, ghost or document change; mapped
        // otherwise.
        next.decorations =
          meta || tr.docChanged || next.ghosts.length !== value.ghosts.length
            ? draw(tr.doc, next)
            : value.decorations.map(tr.mapping, tr.doc);

        return next;
      },
    },
    props: {
      decorations: (state) => {
        const { decorations } = motionKey.getState(state)!;

        return decorations === DecorationSet.empty ? null : decorations;
      },
    },
  });
