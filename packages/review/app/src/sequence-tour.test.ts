import { describe, expect, it } from "vitest";

import {
  createSequenceTourEntry,
  sequenceActiveMessageScrollTarget,
  sequenceActiveMessageScrollTopTarget,
  sequenceView,
} from "./diagrams";

describe("sequence diagram guided tour", () => {
  it("turns canonical source steps into ordered code-tour stops", () => {
    const sequence = sequenceView({
      id: "sign-in",
      title: "Sign in and workspace bootstrap",
      actors: {
        auth: "Better Auth",
        org: "Organization helper",
        db: "Web D1",
        settings: "Settings page",
      },
      steps: [
        {
          id: "authUserWrite",
          type: "step",
          style: "call",
          from: "auth",
          to: "db",
          label: "write user",
          source: "head/src/example.ts#L1-L3",
        },
        {
          id: "orgCreate",
          type: "step",
          style: "call",
          from: "org",
          to: "db",
          label: "create organization",
          source: "head/src/example.ts#L4-L6",
        },
        {
          id: "settingsOrgRead",
          type: "step",
          style: "call",
          from: "db",
          to: "settings",
          label: "read organization",
          source: "head/src/example.ts#L7-L9",
        },
      ],
    });

    const tour = createSequenceTourEntry(sequence);
    expect(tour.title).toBe("Sign in and workspace bootstrap");
    expect(tour.stops).toMatchObject([
      {
        anchor: { id: "authUserWrite" },
        label: "write user",
        detail: "Better Auth -> Web D1",
        content: { kind: "source" },
      },
      {
        anchor: { id: "orgCreate" },
        label: "create organization",
        detail: "Organization helper -> Web D1",
        content: { kind: "source" },
      },
      {
        anchor: { id: "settingsOrgRead" },
        label: "read organization",
        detail: "Web D1 -> Settings page",
        content: { kind: "source" },
      },
    ]);
    expect(sequence.participants.map((participant) => participant.id)).toEqual([
      "auth",
      "org",
      "db",
      "settings",
    ]);
  });

  it("opens inline code for a step without a source anchor", () => {
    const sequence = sequenceView({
      id: "labels",
      title: "Label readability",
      actors: { code: "Code element node", symbol: "Symbol label" },
      steps: [
        {
          id: "allocate",
          type: "step",
          style: "call",
          from: "code",
          to: "symbol",
          label: "allocates more horizontal room",
          code: { language: "bash", text: "whiteboard api review_list" },
        },
      ],
    });

    expect(createSequenceTourEntry(sequence).stops).toEqual([
      {
        anchor: { id: "allocate", title: "allocates more horizontal room" },
        label: "allocates more horizontal room",
        detail: "Code element node -> Symbol label",
        content: {
          kind: "inline-code",
          language: "bash",
          text: "whiteboard api review_list",
        },
      },
    ]);
  });

  it("keeps separate tour stops for steps sharing a source", () => {
    const source = "head/src/example.ts#L1-L3";

    const sequence = sequenceView({
      id: "reuse",
      title: "Reuse",
      actors: { a: "A", b: "B" },
      steps: [
        {
          id: "request",
          type: "step",
          style: "call",
          from: "a",
          to: "b",
          label: "Send",
          source,
        },
        {
          id: "reply",
          type: "step",
          style: "call",
          from: "b",
          to: "a",
          label: "Reply",
          source,
        },
      ],
    });

    expect(
      createSequenceTourEntry(sequence).stops.map((stop) => stop.anchor.id),
    ).toEqual(["request", "reply"]);
    expect(sequence.messages[0]?.source).toEqual(sequence.messages[1]?.source);
  });

  it("calculates scroll targets that reveal the active message participants", () => {
    const sequence = sequenceView({
      id: "evidence-tour",
      title: "Evidence tour",
      actors: {
        reviewer: "Reviewer",
        app: "Review app",
        server: "Server",
        source: "Source reader",
        worker: "Worker",
      },
      steps: [
        {
          id: "localPreview",
          type: "step",
          style: "call",
          from: "reviewer",
          to: "app",
          label: "open preview",
          source: "head/src/example.ts#L1-L3",
        },
        {
          id: "sourceLookup",
          type: "step",
          style: "call",
          from: "app",
          to: "server",
          label: "resolve source range",
          source: "head/src/example.ts#L1-L3",
        },
        {
          id: "workerRefresh",
          type: "step",
          style: "call",
          from: "source",
          to: "worker",
          label: "refresh worker evidence",
          source: "head/src/example.ts#L1-L3",
        },
      ],
    });

    const baseScrollInput = {
      sequence,
      laneWidth: 176,
      viewportWidth: 420,
      scrollWidth: 880,
    };

    expect(
      sequenceActiveMessageScrollTarget({
        ...baseScrollInput,
        activeAnchor: "workerRefresh",
        currentScrollLeft: 0,
      }),
    ).toBe(460);
    expect(
      sequenceActiveMessageScrollTarget({
        ...baseScrollInput,
        activeAnchor: "sourceLookup",
        currentScrollLeft: 150,
      }),
    ).toBe(150);
    expect(
      sequenceActiveMessageScrollTarget({
        ...baseScrollInput,
        activeAnchor: "sourceLookup",
        currentScrollLeft: 480,
      }),
    ).toBe(152);
    expect(
      sequenceActiveMessageScrollTarget({
        ...baseScrollInput,
        activeAnchor: "missing",
        currentScrollLeft: 0,
      }),
    ).toBeNull();

    // Vertical counterpart: rows at messageTop + index * messageGap must be
    // brought into the capped, scrollable diagram body as the tour advances.
    const baseScrollTopInput = {
      sequence,
      messageTop: 112,
      messageGap: 76,
      viewportHeight: 200,
      scrollHeight: 990,
    };

    expect(
      sequenceActiveMessageScrollTopTarget({
        ...baseScrollTopInput,
        activeAnchor: "workerRefresh",
        currentScrollTop: 0,
      }),
    ).toBe(164);
    expect(
      sequenceActiveMessageScrollTopTarget({
        ...baseScrollTopInput,
        activeAnchor: "localPreview",
        currentScrollTop: 50,
      }),
    ).toBe(50);
    expect(
      sequenceActiveMessageScrollTopTarget({
        ...baseScrollTopInput,
        activeAnchor: "localPreview",
        currentScrollTop: 400,
      }),
    ).toBe(88);
    expect(
      sequenceActiveMessageScrollTopTarget({
        ...baseScrollTopInput,
        activeAnchor: "missing",
        currentScrollTop: 0,
      }),
    ).toBeNull();
    expect(
      sequenceActiveMessageScrollTopTarget({
        ...baseScrollTopInput,
        scrollHeight: 200,
        activeAnchor: "workerRefresh",
        currentScrollTop: 0,
      }),
    ).toBeNull();
  });
});
