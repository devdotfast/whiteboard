import * as stylex from "@stylexjs/stylex";

import { controlStyles } from "./controls-styles";

export function Choice<T extends string>({
  label,
  value,
  labels,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  labels: Record<T, string>;
  disabled: boolean;
  onChange: (choice: T) => void;
}) {
  // SAFETY: `labels` is declared as Record<T, string>, so its own keys are
  // exactly the T choices this control offers.
  const choices = Object.keys(labels) as T[];

  return (
    <div
      {...stylex.props(controlStyles.segmented)}
      role="radiogroup"
      aria-label={label}
    >
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={choice === value}
          disabled={disabled}
          {...stylex.props(
            controlStyles.segment,
            choice === value && controlStyles.segmentActive,
          )}
          onClick={() => onChange(choice)}
        >
          {labels[choice]}
        </button>
      ))}
    </div>
  );
}
