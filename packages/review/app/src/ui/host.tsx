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

const TooltipContext = createContext<UseTooltip>(() => noTooltip);

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
