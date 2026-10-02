// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";
import type { AgentTraceStorage } from "./use-agent-trace";
import { type TraceListState, useTraceList } from "./use-trace-list";

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

const listing = (sessionId: string) =>
  Response.json({
    ok: true,
    configured: true,
    sessions: [
      {
        sessionId,
        harness: "unknown",
        available: true,
        source: "r2",
        commits: [],
      },
    ],
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

  function Probe(props: {
    storage: AgentTraceStorage | null;
    provided?: TraceListState;
  }) {
    const list = useTraceList(props.storage, props.provided);

    return (
      <span>
        {list.status === "loaded"
          ? list.sessions.map((item) => item.sessionId).join(",")
          : list.status}
      </span>
    );
  }

  const render = (
    version: number,
    storage: AgentTraceStorage | null = null,
    provided?: TraceListState,
  ) =>
    act(async () =>
      root!.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <DisplayedReviewVersionContext.Provider value={version}>
              <Probe storage={storage} provided={provided} />
            </DisplayedReviewVersionContext.Provider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

  return { container, requests, render };
}

it("never shows a slower listing from a version or store left behind", async () => {
  const { container, requests, render } = harness();

  await render(1);
  await render(2);
  expect(container.textContent).toBe("loading");
  requests[1]!.resolve(listing("version two"));
  await settle();
  expect(container.textContent).toBe("version two");
  requests[0]!.resolve(listing("version one"));
  await settle();
  expect(container.textContent).toBe("version two");

  await render(2, "hosted");
  expect(requests[2]!.url.searchParams.get("storage")).toBe("hosted");
  await render(2, "s3");
  requests[3]!.resolve(listing("s3"));
  await settle();
  requests[2]!.resolve(listing("hosted"));
  await settle();
  expect(container.textContent).toBe("s3");
});

it("uses a supplied listing without a request", async () => {
  const { container, requests, render } = harness();

  await render(1, null, {
    status: "loaded",
    configured: true,
    storage: null,
    sources: [],
    storageError: null,
    sessions: [],
  });
  await settle();
  expect(container.textContent).toBe("");
  expect(requests).toHaveLength(0);
});
