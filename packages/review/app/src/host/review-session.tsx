import type { NormalizedSoftwareModel } from "@canvas/software-map/model";
import type { PinnedSoftwareMapData } from "@canvas/software-map/SoftwareMap";
import { createReviewAppSessionId } from "@canvas/tab-dwell-telemetry";
import type {
  ReviewCanvasBridge,
  ReviewCanvasDiagnostic,
  ReviewTheme,
} from "@dev.fast/review-protocol";
import { ReviewApiClient } from "@review/review-api/client";
import { type ReactNode, createContext, useContext } from "react";

import { reviewApiPath, reviewStorageKey } from "./review-client";
import { type ReviewSurface, createReviewSurface } from "./review-host";
import type { ReviewSessionData } from "./review-session-data";

export interface ReviewSession {
  /** The board its requests name. */
  reviewId: string;
  review?: ReviewSessionData;
  appSessionId: string;
  bridge: ReviewCanvasBridge;
  surface: ReviewSurface;
  softwareMapData?(
    model: NormalizedSoftwareModel,
  ): PinnedSoftwareMapData | undefined;
  fetch: (endpoint: `/${string}`, init?: RequestInit) => Promise<Response>;
  wasmUrl(): string;
  storageKey(
    namespace: string,
    ...parts: Array<string | number | undefined>
  ): string;
  theme(): ReviewTheme;
  signalReady(): void;
  reportDiagnostic(diagnostic: ReviewCanvasDiagnostic): void;
}

/** The host's request, else one that says it serves none. */
export function hostRequest(
  bridge: Pick<ReviewCanvasBridge, "request">,
): NonNullable<ReviewCanvasBridge["request"]> {
  return (
    bridge.request ??
    (() => Promise.reject(new Error("This host serves no requests.")))
  );
}

/** The review API through the host, whose request adds the origin and
 * credentials. */
export function hostApiClient(
  bridge: Pick<ReviewCanvasBridge, "request">,
): ReviewApiClient {
  return new ReviewApiClient({ serverUrl: "", token: "" }, hostRequest(bridge));
}

export function createReviewSession(
  bridge: ReviewCanvasBridge,
  options: { jsonReview: { id: string; version(): number | undefined } },
): ReviewSession {
  const reviewId = options.jsonReview.id;

  return {
    reviewId,
    appSessionId: bridge.appSessionId ?? createReviewAppSessionId(),
    bridge,
    surface: createReviewSurface(bridge),
    fetch: (endpoint, init) =>
      hostRequest(bridge)(
        reviewApiPath(reviewId, endpoint, {
          version: options.jsonReview.version(),
        }),
        init,
      ),
    wasmUrl: () => bridge.wasmUrl,
    storageKey: (namespace, ...parts) =>
      reviewStorageKey({ reviewId }, namespace, ...parts),
    theme: () => bridge.currentTheme(),
    signalReady: () => bridge.ready(),
    reportDiagnostic: (diagnostic) => bridge.reportDiagnostic?.(diagnostic),
  };
}

const ReviewSessionContext = createContext<ReviewSession | null>(null);

export function ReviewSessionProvider({
  session,
  children,
}: {
  session: ReviewSession;
  children: ReactNode;
}) {
  return (
    <ReviewSessionContext.Provider value={session}>
      {children}
    </ReviewSessionContext.Provider>
  );
}

export function useOptionalReviewSession(): ReviewSession | null {
  return useContext(ReviewSessionContext);
}

export function useReviewSession(): ReviewSession {
  const session = useOptionalReviewSession();

  if (!session) {
    throw new Error(
      "useReviewSession must be used within ReviewSessionProvider",
    );
  }

  return session;
}
