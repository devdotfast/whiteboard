import { type RefObject, useEffect, useEffectEvent } from "react";

const scopes = new Set<RefObject<HTMLElement | null>>();

/** Escape inside `within`, else outside every scoped one. */
export function useEscape(
  onEscape: () => void,
  {
    enabled = true,
    within,
  }: { enabled?: boolean; within?: RefObject<HTMLElement | null> } = {},
): void {
  const escape = useEffectEvent(onEscape);

  useEffect(() => {
    if (!enabled) return;

    if (within) scopes.add(within);

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Node)) return;
      const target = event.target;

      const inside = within
        ? within.current?.contains(target)
        : ![...scopes].some((scope) => scope.current?.contains(target));

      if (!inside) return;
      event.preventDefault();
      escape();
    };

    document.addEventListener("keydown", keydown);

    return () => {
      document.removeEventListener("keydown", keydown);

      if (within) scopes.delete(within);
    };
  }, [enabled, within]);
}
