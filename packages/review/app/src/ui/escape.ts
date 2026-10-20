import { useEffect, useEffectEvent } from "react";

/** Calls `onEscape` on Escape anywhere in the document while `enabled`. A
 * popover that stops its own Escape is not seen. */
export function useEscape(onEscape: () => void, enabled = true): void {
  const escape = useEffectEvent(onEscape);

  useEffect(() => {
    if (!enabled) return;

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      escape();
    };

    document.addEventListener("keydown", keydown);

    return () => document.removeEventListener("keydown", keydown);
  }, [enabled]);
}
