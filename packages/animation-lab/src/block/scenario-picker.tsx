import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { Scenario } from "./model";

/**
 * One row of scenarios under the block's header, sized for three to six.
 * It is a radio group: Tab reaches the chosen scenario, the arrow keys,
 * Home and End move the choice. A row too wide for the block scrolls
 * sideways and keeps the chosen scenario in view; a long label truncates
 * and shows in full on hover.
 */
export function ScenarioPicker({
  scenarios,
  chosen,
  onChoose,
}: {
  scenarios: Scenario[];
  chosen: Scenario;
  onChoose(scenario: Scenario): void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ before: false, after: false });

  // Fade whichever end has scenarios scrolled out of sight.
  useEffect(() => {
    const element = row.current;

    if (!element) return;

    const measure = () =>
      setOverflow({
        before: element.scrollLeft > 1,
        after:
          element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });

    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(element);

    return () => {
      element.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, []);

  const choose = (scenario: Scenario) => {
    onChoose(scenario);

    const button = row.current?.querySelector<HTMLElement>(
      `[data-scenario="${CSS.escape(scenario.id)}"]`,
    );

    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = scenarios.indexOf(chosen);
    const last = scenarios.length - 1;

    const next = {
      ArrowRight: Math.min(index + 1, last),
      ArrowDown: Math.min(index + 1, last),
      ArrowLeft: Math.max(index - 1, 0),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    const scenario = scenarios[next];

    // At either end the key stays put, and must not restart the steps.
    if (scenario && scenario !== chosen) choose(scenario);
  };

  return (
    <div
      ref={row}
      className="scenarios"
      data-fade-before={overflow.before || undefined}
      data-fade-after={overflow.after || undefined}
      role="radiogroup"
      aria-label="Scenario"
    >
      {scenarios.map((item) => {
        const checked = item.id === chosen.id;

        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="scenario"
            data-scenario={item.id}
            title={item.label}
            onClick={() => choose(item)}
            onKeyDown={onKeyDown}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
