// @vitest-environment jsdom
import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import {
  type QueryClient,
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { CanvasQueryProvider, useCanvasQueryScope } from "./canvas-query";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  onlineManager.setOnline(true);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

type Host = Pick<ReviewCanvasBridge, "request">;

const apiHost = (): Host => ({ request: (url, init) => fetch(url, init) });

function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  return container;
}

function Canvas({
  host,
  reviewId,
  children,
}: {
  host: Host;
  reviewId: string;
  children: ReactNode;
}) {
  const scope = useCanvasQueryScope(host.request, reviewId);

  return <CanvasQueryProvider scope={scope}>{children}</CanvasQueryProvider>;
}

function Probe({
  name,
  read,
  onClient,
}: {
  name: string;
  read: () => Promise<string>;
  onClient?: (client: QueryClient) => void;
}) {
  onClient?.(useQueryClient());
  const { data } = useQuery({ queryKey: ["probe"], queryFn: read });

  return <span>{`${name}:${data ?? "…"};`}</span>;
}

it("keeps its cache through a Strict Mode replay and drops it on unmount", async () => {
  const container = mount();
  const read = vi.fn<() => Promise<string>>(async () => "value");
  let client: QueryClient | undefined;

  await act(async () =>
    root!.render(
      <StrictMode>
        <Canvas host={apiHost()} reviewId="review">
          <Probe name="a" read={read} onClient={(next) => (client = next)} />
        </Canvas>
      </StrictMode>,
    ),
  );
  await settle();
  expect(container.textContent).toBe("a:value;");
  expect(read).toHaveBeenCalledTimes(1);
  expect(client!.getQueryCache().getAll()).toHaveLength(1);

  await act(async () => root!.unmount());
  root = undefined;
  await settle();
  expect(client!.getQueryCache().getAll()).toHaveLength(0);
});

it("gives each canvas and each backend its own cache", async () => {
  const container = mount();
  const first = apiHost();

  const render = (backend: Host, reads: string[]) =>
    act(async () =>
      root!.render(
        <>
          <Canvas host={backend} reviewId="review">
            <Probe name="a" read={async () => reads[0]!} />
          </Canvas>
          <Canvas host={first} reviewId="other">
            <Probe name="b" read={async () => reads[1]!} />
          </Canvas>
        </>,
      ),
    );

  await render(first, ["one", "two"]);
  await settle();
  expect(container.textContent).toBe("a:one;b:two;");

  await render(apiHost(), ["three", "four"]);
  await settle();
  expect(container.textContent).toBe("a:three;b:two;");
});

it("reads and writes the local API while the browser reports offline", async () => {
  const container = mount();
  onlineManager.setOnline(false);

  function Offline() {
    const read = useQuery({
      queryKey: ["offline"],
      queryFn: async () => "read",
    });

    const write = useMutation({ mutationFn: async () => "written" });

    return (
      <button onClick={() => write.mutate()}>
        {`${read.data ?? "…"}:${write.data ?? "…"}`}
      </button>
    );
  }

  await act(async () =>
    root!.render(
      <Canvas host={apiHost()} reviewId="review">
        <Offline />
      </Canvas>,
    ),
  );
  await settle();
  await act(async () => container.querySelector("button")!.click());
  await settle();
  expect(container.textContent).toBe("read:written");
});

it("leaves reads idle for a host that serves no requests", async () => {
  const container = mount();
  const read = vi.fn<() => Promise<string>>(async () => "value");

  await act(async () =>
    root!.render(
      <Canvas host={{}} reviewId="review">
        <Probe name="a" read={read} />
      </Canvas>,
    ),
  );
  await settle();
  expect(container.textContent).toBe("a:…;");
  expect(read).not.toHaveBeenCalled();
});
