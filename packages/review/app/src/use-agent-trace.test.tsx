// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";
import { useAgentTrace } from "./use-agent-trace";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const detail = (sessionId: string) =>
  Response.json({
    ok: true,
    parserVersion: "1.0",
    session: {
      sessionId,
      harness: "pi",
      available: true,
      source: "r2",
      commits: [],
    },
    title: `Trace ${sessionId}`,
    subagents: [],
    startedAt: "2025-01-01T00:00:00Z",
    endedAt: "2025-01-01T00:01:00Z",
    activeMs: 60000,
    userTurns: 1,
    toolCalls: 0,
    events: [],
  });

function harness() {
  const requests: { url: URL; resolve(response: Response): void }[] = [];

  const session = testReviewSession(
    {},
    {
      request: (url) =>
        new Promise<Response>((resolve) =>
          requests.push({ url: new URL(url), resolve }),
        ),
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Probe({ sessionId }: { sessionId: string }) {
    const trace = useAgentTrace(sessionId);

    return (
      <span>
        {trace.status === "loaded" ? trace.trace.title : trace.status}
      </span>
    );
  }

  const render = (sessionId: string) =>
    act(async () =>
      root!.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <Probe sessionId={sessionId} />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

  return { container, requests, render };
}

it("shows a slow trace only for the session that asked for it", async () => {
  const { container, requests, render } = harness();
  await render("a");
  await render("b");
  await settle();

  requests[0]!.resolve(detail("a"));
  await settle();
  expect(container.textContent).toBe("loading");

  requests[1]!.resolve(detail("b"));
  await settle();
  expect(container.textContent).toBe("Trace b");
});

it("shows a recently viewed trace at once while it refreshes", async () => {
  const { container, requests, render } = harness();
  await render("a");
  await settle();
  requests[0]!.resolve(detail("a"));
  await settle();

  await render("b");
  await settle();
  requests[1]!.resolve(detail("b"));
  await settle();

  await render("a");
  expect(container.textContent).toBe("Trace a");
  await settle();
  expect(requests).toHaveLength(3);
});
