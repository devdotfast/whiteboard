import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False on a server and while hydrating its markup, then true. A client
 * render that is not hydrating, as in Desktop, reads true from the start. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
