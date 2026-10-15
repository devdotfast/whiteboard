import {
  type ReactNode,
  type RefCallback,
  createContext,
  useContext,
} from "react";

/** Attaches a tooltip to an element; the host supplies the real one. */
export type UseTooltip = <T extends HTMLElement = HTMLButtonElement>(
  text: string,
  options?: { instant?: boolean },
) => RefCallback<T>;

const noTooltip: RefCallback<HTMLElement> = () => {};

let warned = false;

// Every root installs UiHostProvider; without one, tooltips silently vanish.
const missingHost: UseTooltip = () => {
  if (!warned)
    console.warn(
      "A UI kit component has no UiHostProvider above it, so it shows no tooltip.",
    );
  warned = true;

  return noTooltip;
};

const TooltipContext = createContext<UseTooltip>(missingHost);

export function UiHostProvider({
  useTooltip,
  children,
}: {
  useTooltip: UseTooltip;
  children: ReactNode;
}) {
  return (
    <TooltipContext.Provider value={useTooltip}>
      {children}
    </TooltipContext.Provider>
  );
}

export function useUiTooltip<T extends HTMLElement = HTMLButtonElement>(
  text: string,
  options?: { instant?: boolean },
): RefCallback<T> {
  return useContext(TooltipContext)<T>(text, options);
}
