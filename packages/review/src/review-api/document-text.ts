import { boardTitle } from "@dev.fast/review-protocol";
import {
  type Element,
  ReviewInputError,
  animationCode,
  elements,
  stepSources,
} from "@dev.fast/whiteboard-document";

import type { AnimationRun } from "./animation-runs.js";
import type { Snapshot } from "./store.js";

interface RelatedBoard {
  id: string;
  title: string;
}

/** A reading view of saved content, not another document format to maintain. */
export function documentText(
  snapshot: Snapshot,
  targetId?: string,
  full = false,
  /** Where the whiteboard sits among its project's, by title. */
  relations?: {
    parent?: RelatedBoard;
    children: RelatedBoard[];
    dependsOn: RelatedBoard[];
  },
  /** Each animation's last run in a canvas, when this is the current version. */
  runs?: ReadonlyMap<string, AnimationRun>,
): string {
  const target =
    targetId === undefined
      ? undefined
      : elements(snapshot.document).find((item) => item.id === targetId);

  if (targetId !== undefined && !target)
    throw new ReviewInputError("Target not found in this version.", 404);
  const detailed = full || target !== undefined;

  const lines = [
    `# ${boardTitle(snapshot.title)}`,
    `Session ${snapshot.reviewId} · version ${snapshot.version}`,
  ];

  // The commits code links resolve against, so an agent can read the lines
  // it links with `git show <head>:<path>`.
  if (snapshot.pins)
    lines.push(`Base ${snapshot.pins.base} · head ${snapshot.pins.head}`);

  if (relations && targetId === undefined) {
    const list = (boards: RelatedBoard[]) =>
      boards
        .map((board) => `${boardTitle(board.title)} (${board.id})`)
        .join(", ");

    if (relations.parent) lines.push(`Parent: ${list([relations.parent])}`);

    if (relations.children.length)
      lines.push(`Children, in order: ${list(relations.children)}`);

    if (relations.dependsOn.length)
      lines.push(`Depends on: ${list(relations.dependsOn)}`);
  }

  lines.push("");

  const write = (depth: number, text: string) => {
    for (const line of text.split("\n")) lines.push("  ".repeat(depth) + line);
  };

  const code = (depth: number, value: { language: string; text: string }) => {
    write(depth, `Code (${value.language}):`);
    write(depth + 1, value.text);
  };

  const render = (element: Element, depth: number) => {
    const title = "title" in element ? element.title : undefined;
    write(depth, `[${element.id}] ${element.type}${title ? `: ${title}` : ""}`);
    const detail = (text: string) => write(depth + 1, text);

    switch (element.type) {
      case "section":
      case "callout":
        if (element.type === "callout") detail(`Tone: ${element.tone}`);

        if (element.type === "section" && element.defaultCollapsed)
          detail("Initially collapsed");
        element.children.forEach((child) => render(child, depth + 1));
        break;
      case "markdown":
        detail(
          detailed
            ? element.markdown
            : element.markdown.split("\n")[0] +
                (element.markdown.includes("\n") ? " …" : ""),
        );
        break;
      case "code":
        if (element.caption) detail(element.caption);

        if (detailed) code(depth + 1, element);
        else
          detail(
            `${element.language}, ${element.text.split("\n").length} lines`,
          );
        break;
      case "divider":
        break;
      case "code_peek":
        detail(element.source);

        if (element.caption) detail(element.caption);
        break;
      case "sequence":
        for (const [key, label] of Object.entries(element.actors))
          detail(`Actor ${key}: ${label}`);
        element.steps.forEach((step) => render(step, depth + 1));
        break;
      case "step":
        detail(
          `${element.from} → ${element.to}: ${element.label} (${element.style})`,
        );

        for (const source of stepSources(element)) detail(source);

        if (detailed && element.explanation) detail(element.explanation);

        if (detailed && element.code) code(depth + 1, element.code);
        break;
      case "call_stack_diff":
        for (const side of ["base", "head"] as const) {
          detail(`${side}:`);
          element[side].forEach((frame) => {
            write(
              depth + 2,
              `${frame.label ?? frame.key ?? "Frame"}: ${frame.source}`,
            );

            if (detailed && frame.via)
              write(depth + 3, `${frame.via.kind}: ${frame.via.reason}`);
          });
        }

        break;
      case "database_lens":
        for (const [key, label] of Object.entries(element.actors))
          detail(`Actor ${key}: ${label}`);

        for (const [key, store] of Object.entries(element.stores)) {
          detail(`Store ${key}: ${store.label} (${store.storage})`);

          for (const [key, collection] of Object.entries(store.collections)) {
            write(depth + 2, `Collection ${key}: ${collection.label}`);

            if (detailed)
              for (const [key, field] of Object.entries(collection.fields)) {
                write(
                  depth + 3,
                  `${key}: ${field.label}, ${field.dataType}${field.primaryKey ? ", primary key" : ""}${field.nullable ? ", nullable" : ""}${field.references ? ` → ${field.references.store}.${field.references.collection}.${field.references.field}` : ""}`,
                );
              }
          }
        }

        for (const useCase of element.useCases) {
          detail(`Use case: ${useCase.label}`);

          if (detailed && useCase.summary) write(depth + 2, useCase.summary);

          for (const operation of useCase.operations)
            write(
              depth + 2,
              `${operation.actor}: ${operation.kind} ${operation.store}.${operation.collection}${operation.field ? `.${operation.field}` : ""} — ${operation.label} (${operation.source})`,
            );
        }

        break;
      case "image":
        detail(`${element.alt} (asset: ${element.assetId})`);

        if (element.caption) detail(element.caption);
        break;
      case "trace_quote":
        detail(`${element.traceId}, event ${element.eventId}`);
        detail(element.text);
        break;
      case "flow_diagram":
        if (element.description) detail(element.description);

        for (const node of element.nodes) {
          detail(`[${node.id}] ${node.key}: ${node.label}`);

          if (detailed && node.description) write(depth + 2, node.description);

          for (const attachment of node.attachments)
            write(
              depth + 2,
              `${attachment.label}: ${attachment.sources.join(", ")}`,
            );
        }

        for (const edge of element.edges)
          detail(
            `[${edge.id}] ${edge.from} → ${edge.to}${edge.label ? `: ${edge.label}` : ""}`,
          );
        break;
      case "diagram":
        if (element.description) detail(element.description);

        for (const [index, frame] of (element.frames ?? []).entries()) {
          detail(
            `Frame ${index + 1} [${frame.key}]: ${frame.title}${frame.caption ? ` — ${frame.caption}` : ""}`,
          );

          if (frame.code) write(depth + 2, `Code: ${frame.code.join(", ")}`);

          for (const move of frame.moves ?? [])
            write(
              depth + 2,
              `Move: ${move.from} → ${move.to}${move.label ? ` (${move.label})` : ""}`,
            );
        }

        for (const scenario of element.scenarios ?? [])
          detail(
            `Scenario [${scenario.key}] ${scenario.label}: ${scenario.frames.join(" → ")}`,
          );

        for (const [index, chapter] of (
          element.timeline?.chapters ?? []
        ).entries())
          detail(
            `Chapter ${index + 1} [${chapter.key}]: ${chapter.title} (${chapter.duration} ms)`,
          );

        if (runs) {
          const run =
            element.id === undefined ? undefined : runs.get(element.id);

          write(depth + 1, runText(run));

          for (const finding of run?.findings ?? [])
            write(depth + 2, `Finding: ${finding}`);

          if (run?.claims) {
            const { matches, changed, unlinked } = run.claims;

            write(
              depth + 1,
              `Claims: ${matches} match, ${changed} changed, ${unlinked} unlinked.${run.claims.changedLabels.length ? ` Changed: ${run.claims.changedLabels.join(", ")}.` : ""}${run.claims.unlinkedLabels.length ? ` Unlinked: ${run.claims.unlinkedLabels.join(", ")}.` : ""}`,
            );
          }
        }

        for (const [name, entry] of Object.entries(element.code))
          detail(
            `Code ${name}${entry.label ? ` (${entry.label})` : ""}: ${entry.source}`,
          );

        if (detailed && element.html !== undefined)
          code(depth + 1, { language: "html", text: element.html });

        if (detailed && element.script !== undefined)
          code(depth + 1, { language: "javascript", text: element.script });
        break;
      case "animation":
      case "clip":
        if (element.type === "animation") {
          for (const [index, frame] of element.frames.entries()) {
            detail(
              `Frame ${index + 1} [${frame.key}]: ${frame.title}${frame.caption ? ` — ${frame.caption}` : ""}`,
            );

            if (frame.code) write(depth + 2, `Code: ${frame.code.join(", ")}`);

            if (detailed && frame.data !== undefined)
              write(depth + 2, `Data: ${JSON.stringify(frame.data)}`);
          }

          for (const scenario of element.scenarios ?? [])
            detail(
              `Scenario [${scenario.key}] ${scenario.label}: ${scenario.frames.join(" → ")}`,
            );
        } else {
          for (const [index, marker] of element.markers.entries()) {
            detail(
              `Marker ${index + 1} [${marker.key}]: ${marker.title}${marker.caption ? ` — ${marker.caption}` : ""}`,
            );

            if (marker.code)
              write(depth + 2, `Code: ${marker.code.join(", ")}`);
          }

          for (const scenario of element.scenarios ?? [])
            detail(`Scenario [${scenario.key}] ${scenario.label}`);
        }

        if (runs) {
          const run =
            element.id === undefined ? undefined : runs.get(element.id);

          write(depth + 1, runText(run));
        }

        for (const [name, entry] of Object.entries(element.code)) {
          const { source, label } = animationCode(entry);

          detail(`Code ${name}${label ? ` (${label})` : ""}: ${source}`);
        }

        if (detailed) code(depth + 1, { language: "html", text: element.html });
        break;
      case "software_map":
        detail(
          `Map: ${element.mapVersionId}${element.focusElementId ? `, focus: ${element.focusElementId}` : ""}`,
        );
        break;
    }
  };

  (target ? [target] : snapshot.document).forEach((element) =>
    render(element, 0),
  );

  if (!snapshot.document.length) lines.push("(Empty review)");

  // Lenses sit beside the document; list them so their ids are at hand.
  if (!target && snapshot.lenses?.length) {
    lines.push("", "Lenses (edit with session_lens_edit):");

    for (const lens of snapshot.lenses) {
      write(0, `[${lens.id}] ${lens.title}`);

      for (const item of lens.targets)
        if (item.kind === "files")
          write(1, `Files: ${item.patterns.join(", ")}`);
        else for (const source of item.sources) write(1, `Range: ${source}`);
    }
  }

  if (!detailed && snapshot.document.length)
    lines.push(
      "",
      "Use targetId for one component's complete content, or full:true for the whole review.",
    );

  return lines.join("\n");
}

/** What a canvas last saw an animation's or diagram's script do. */
function runText(run: AnimationRun | undefined): string {
  if (run?.error) return `Script error: ${run.error}`;

  return run
    ? "Ran in an open whiteboard without a script error."
    : "Not run yet: its script runs only where the whiteboard is open.";
}
