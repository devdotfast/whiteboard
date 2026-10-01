import type { ActivitySnapshot } from "@review/review-api/activity";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  AuthoringActivityBadge,
  ReviewSurfaceLabel,
} from "./authoring-activity";
import { AuthoringActivityContext } from "./authoring-activity-context";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";

import "./styles.css";

const working: ActivitySnapshot = {
  workingCount: 1,
  expiresAt: null,
  activities: [{ activityId: "a", slot: 0 }],
};

const idle: ActivitySnapshot = { workingCount: 0, expiresAt: null };

let container: HTMLElement, root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function show(state: {
  activity: ActivitySnapshot;
  version: number;
  hasContent?: boolean;
  active?: boolean;
}) {
  await act(async () =>
    root.render(
      <AuthoringActivityContext.Provider value={state.activity}>
        <DisplayedReviewVersionContext.Provider value={state.version}>
          <ReviewSurfaceLabel
            hasContent={state.hasContent ?? true}
            active={state.active ?? false}
          />
        </DisplayedReviewVersionContext.Provider>
      </AuthoringActivityContext.Provider>,
    ),
  );
}

const unread = () => container.querySelector('[aria-hidden="true"]') !== null;

const shimmering = () => container.querySelector("[data-working]") !== null;

it("marks the review unread when the authoring lease ends while the reader is elsewhere", async () => {
  await show({ activity: working, version: 3 });
  expect(shimmering()).toBe(true);
  expect(unread()).toBe(false);

  // More content arrives under the same live lease: still not ready.
  await show({ activity: working, version: 4 });
  expect(unread()).toBe(false);

  // The lease ends without a new version; that alone makes it ready.
  await show({ activity: idle, version: 4 });
  expect(shimmering()).toBe(false);
  expect(unread()).toBe(true);

  // Visiting the tab reads it; leaving again keeps it read.
  await show({ activity: idle, version: 4, active: true });
  expect(unread()).toBe(false);
  await show({ activity: idle, version: 4 });
  expect(unread()).toBe(false);

  // A later version finished while the reader is elsewhere is unread again.
  await show({ activity: working, version: 5 });
  expect(unread()).toBe(false);
  await show({ activity: idle, version: 5 });
  expect(unread()).toBe(true);
});

it("treats a finished review as read at mount and an empty one as never ready", async () => {
  await show({ activity: idle, version: 2 });
  expect(unread()).toBe(false);

  await act(async () => root.unmount());
  root = createRoot(container);
  await show({ activity: working, version: 0, hasContent: false });
  await show({ activity: idle, version: 0, hasContent: false });
  expect(unread()).toBe(false);
});

const longDescription =
  "Reviewing copy selection and publishing stack · Group selection tests and Copy for Agent implementation";

const longUpdate: ActivitySnapshot = {
  ...working,
  activities: [
    { activityId: "a", slot: 0, focus: { description: longDescription } },
  ],
};

it("keeps a long update inside the badge and puts the whole of it in the tooltip", async () => {
  container.style.display = "flex";
  container.style.width = "900px";
  await act(async () =>
    root.render(
      <AuthoringActivityContext.Provider value={longUpdate}>
        <AuthoringActivityBadge />
      </AuthoringActivityContext.Provider>,
    ),
  );

  const badge = container.querySelector<HTMLElement>(
    ".host-authoring-activity",
  )!;

  const text = badge.querySelector<HTMLElement>(":scope > span")!;

  // The text is cut short rather than running past the badge's edge.
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
  expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
    badge.getBoundingClientRect().right,
  );

  // Without a Desktop host the tooltip falls back to a native title.
  expect(badge.title).toContain(longDescription);
});

const two: ActivitySnapshot = {
  workingCount: 2,
  expiresAt: null,
  activities: [
    {
      activityId: "writer",
      slot: 0,
      focus: { description: "Writing §3 · failure modes" },
    },
    {
      activityId: "lenses",
      slot: 1,
      surface: "lenses",
      focus: { description: "Grouping files into lenses" },
    },
  ],
};

it("shows one pill per agent, each in its own color, opening the page it writes on", async () => {
  const located: string[] = [];
  container.className = "review-canvas-root";

  await act(async () =>
    root.render(
      <AuthoringActivityContext.Provider value={two}>
        <AuthoringActivityBadge onLocate={(view) => located.push(view)} />
      </AuthoringActivityContext.Provider>,
    ),
  );

  const pills = [
    ...container.querySelectorAll<HTMLElement>(".host-authoring-activity"),
  ];

  expect(pills.map((pill) => pill.textContent)).toEqual([
    "Writing §3 · failure modes",
    "Grouping files into lenses",
  ]);

  const accents = pills.map((pill) =>
    getComputedStyle(pill).getPropertyValue("--accent").trim(),
  );

  expect(accents[0]).not.toBe(accents[1]);
  await act(async () => pills[1]!.click());
  expect(located).toEqual(["diff"]);
});
