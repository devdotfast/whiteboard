import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

// The package build's stand-in for use-sync-external-store's CommonJS shims,
// whose require("react") fails once React is external. A port of its
// with-selector over React's own useSyncExternalStore.
export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | null | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const committed = useRef<{ selection: Selection }>(undefined);

  const [getSelection, getServerSelection] = useMemo(() => {
    let memoized: { snapshot: Snapshot; selection: Selection } | undefined;

    const select = (snapshot: Snapshot) => {
      if (memoized && Object.is(memoized.snapshot, snapshot))
        return memoized.selection;

      const next = selector(snapshot);
      const previous = memoized ?? committed.current;

      const selection =
        previous && isEqual?.(previous.selection, next)
          ? previous.selection
          : next;

      memoized = { snapshot, selection };

      return selection;
    };

    return [
      () => select(getSnapshot()),
      getServerSnapshot ? () => select(getServerSnapshot()) : undefined,
    ];
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  );

  useEffect(() => {
    committed.current = { selection: value };
  }, [value]);
  useDebugValue(value);

  return value;
}

export { useSyncExternalStore };

export default { useSyncExternalStore, useSyncExternalStoreWithSelector };
