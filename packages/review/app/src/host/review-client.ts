/** What names a board's stored state. */
export interface ReviewClientConfig {
  reviewId?: string;
}

/** The review API path of a board's `endpoint`, at `version` if given. */
export function reviewApiPath(
  reviewId: string,
  endpoint: `/${string}`,
  options: { version?: number } = {},
): string {
  const url = new URL(
    `/reviews-api/${encodeURIComponent(reviewId)}${endpoint}`,
    "http://review.invalid",
  );

  if (options.version !== undefined)
    url.searchParams.set("version", String(options.version));

  return url.pathname + url.search;
}

export async function reviewFetchUrl(
  connection: { token?: string },
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (connection.token) headers.set("x-review-token", connection.token);

  return fetch(url, { ...init, headers });
}

export function reviewStorageKey(
  config: ReviewClientConfig | null,
  namespace: string,
  ...parts: Array<string | number | undefined>
): string {
  return [
    "progressive-review",
    namespace,
    config?.reviewId ?? "server-render",
    ...parts.map((part) => String(part ?? "")),
  ].join(":");
}

// Unlike reviewStorageKey, this omits the review identity: UI preferences
// like panel widths belong to the reader, not to one review, so they
// apply across reviews.
export function reviewPreferenceKey(
  namespace: string,
  ...parts: Array<string | number | undefined>
): string {
  return [
    "progressive-review",
    namespace,
    ...parts.map((part) => String(part ?? "")),
  ].join(":");
}
