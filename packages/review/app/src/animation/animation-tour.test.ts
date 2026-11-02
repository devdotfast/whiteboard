import type { SourcePeekAnchor } from "@canvas/review-panel-model";
import {
  type DiffSelection,
  animationCodeId,
} from "@dev.fast/whiteboard-document";
import { describe, expect, it } from "vitest";

import {
  type AnimationFrame,
  animationTour,
  frameAnchorId,
  markerAnchorId,
} from "./animation-tour";

const block = { id: "anim", title: "Order flow" };

const selection = (line: number): DiffSelection => ({
  file: "order.ts",
  start: { side: "head", line },
  end: { side: "head", line },
});

const anchors = new Map<string, SourcePeekAnchor>(
  (["save", "send"] as const).map((name, index) => [
    animationCodeId(block.id, name),
    {
      id: animationCodeId(block.id, name),
      title: name,
      peek: selection(index + 1),
    },
  ]),
);

const frames: AnimationFrame[] = [
  { key: "a", title: "Arrives" },
  { key: "b", title: "Saved", caption: "The row is written.", code: ["save"] },
  { key: "c", title: "Sent", code: ["missing", "send", "save"] },
];

describe("animationTour", () => {
  it("has a stop per frame of the path, in order", () => {
    const tour = animationTour(block, anchors, [frames[2]!, frames[0]!]);

    expect(tour?.id).toBe("anim");
    expect(tour?.title).toBe("Order flow");
    expect(tour?.stops.map((stop) => stop.anchor.id)).toEqual([
      "anim:frame:c",
      "anim:frame:a",
    ]);
  });

  it("shows a frame's resolving code, the rest after the first", () => {
    const [arrives, saved, sent] = animationTour(block, anchors, frames)!.stops;

    expect(arrives).toEqual({
      anchor: { id: "anim:frame:a", title: "Arrives" },
      label: "Arrives",
      content: { kind: "explanation", text: "Arrives" },
    });
    expect(saved).toEqual({
      anchor: {
        id: "anim:frame:b",
        title: "Saved",
        detail: "The row is written.",
        peek: selection(1),
      },
      label: "Saved",
      detail: "The row is written.",
      content: { kind: "source", source: selection(1) },
    });
    expect(sent?.anchor.peek).toEqual(selection(2));
    expect(sent?.content).toEqual({
      kind: "source",
      source: selection(2),
      more: [selection(1)],
    });
  });

  it("explains a frame by its caption when its code does not resolve", () => {
    const tour = animationTour(block, anchors, [
      { key: "x", title: "Waits", caption: "Nothing yet.", code: ["missing"] },
      frames[1]!,
    ]);

    expect(tour?.stops[0]?.content).toEqual({
      kind: "explanation",
      text: "Nothing yet.",
    });
    expect(tour?.stops[0]?.anchor.peek).toBeUndefined();
  });

  it("is absent when no frame of the path shows code that resolves", () => {
    expect(animationTour(block, anchors, [frames[0]!])).toBeNull();
    expect(
      animationTour(block, new Map(), [frames[1]!, frames[2]!]),
    ).toBeNull();
  });
});

describe("animationTour over a clip's markers", () => {
  it("has a stop per marker, named for the marker", () => {
    const markers = [
      { key: "sent", title: "Sent", code: ["send"] },
      { key: "saved", title: "Saved", caption: "The row lands." },
    ];

    const tour = animationTour(block, anchors, markers, markerAnchorId);

    expect(tour?.stops.map((stop) => [stop.anchor.id, stop.content])).toEqual([
      ["anim:marker:sent", { kind: "source", source: selection(2) }],
      ["anim:marker:saved", { kind: "explanation", text: "The row lands." }],
    ]);
  });
});

describe("code opened from the drawing", () => {
  it("replaces its stop's code and leaves the other stops alone", () => {
    const plain = animationTour(block, anchors, frames);

    const tour = animationTour(block, anchors, frames, frameAnchorId, {
      stop: frames[2]!.key,
      name: "save",
    });

    const opened = tour?.stops.find(
      (stop) => stop.anchor.id === frameAnchorId(block.id, frames[2]!.key),
    );

    expect(opened?.content).toEqual({ kind: "source", source: selection(1) });
    expect(
      tour?.stops.filter((stop) => stop !== opened).map((s) => s.content),
    ).toEqual(
      plain?.stops
        .filter((stop) => stop.anchor.id !== opened?.anchor.id)
        .map((s) => s.content),
    );
  });
});
