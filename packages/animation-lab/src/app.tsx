import { useEffect, useRef, useState } from "react";

import {
  AnimationBlock,
  type AnimationBlockHandle,
} from "./block/animation-block";
import type { AnimationBlockData, SelectedItem } from "./block/model";

// Every JSON file in fixtures/ is a case; adding a file adds a tab.
const fixtures = import.meta.glob<AnimationBlockData>("./fixtures/*.json", {
  eager: true,
  import: "default",
});

// A fixture's mock repository, standing in for its code at head.
const repos = import.meta.glob<Record<string, string>>(
  "./fixtures/repos/*.json",
  { eager: true, import: "default" },
);

const names = Object.keys(fixtures)
  .map((path) => path.slice("./fixtures/".length, -".json".length))
  .toSorted();

export function App() {
  const [name, setName] = useState(names[0] ?? "");
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectedItem[]>([]);
  const block = useRef<AnimationBlockHandle>(null);
  const data = fixtures[`./fixtures/${name}.json`];

  // Escape on the page works as it does in the stage: it clears the
  // selection, then leaves selection mode.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (selection.length) block.current?.clear();
      else setSelecting(false);
    };

    addEventListener("keydown", onKey);

    return () => removeEventListener("keydown", onKey);
  }, [selection.length]);

  return (
    <main className="lab">
      <div className="lab-bar">
        <nav className="lab-fixtures" aria-label="Fixtures">
          {names.map((item) => (
            <button
              key={item}
              type="button"
              className="lab-fixture"
              aria-pressed={item === name}
              onClick={() => {
                setName(item);
                setSelection([]);
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="lab-select">
          <button
            type="button"
            className="lab-select-toggle"
            aria-pressed={selecting}
            title="Shift-click adds · Esc clears, then exits"
            onClick={() => setSelecting(!selecting)}
          >
            <PointerIcon />
            {selecting ? "Selecting" : "Select"}
          </button>
        </div>
      </div>
      {data ? (
        <AnimationBlock
          key={name}
          ref={block}
          data={data}
          repo={repos[`./fixtures/repos/${name}.json`]}
          selecting={selecting}
          onSelection={setSelection}
          onSelectExit={() => setSelecting(false)}
        />
      ) : (
        <p>No fixtures yet.</p>
      )}
      {selection.length > 0 && (
        <section className="lab-context" aria-label="In the model's context">
          <span className="lab-context-title">
            In context · {selection.length}
          </span>
          <ul className="lab-context-list">
            {selection.map((item) => (
              <li key={item.id} className="lab-chip">
                <span className="lab-chip-label">{item.label}</span>
                <span className="lab-chip-kind">{item.kind}</span>
                <button
                  type="button"
                  className="lab-chip-remove"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => block.current?.deselect(item.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function PointerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 2l8 4.2-3.4 1.2L6.4 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
