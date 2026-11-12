/** Fields and code editors type the keys pressed in them. */
const FIELD = "input, textarea, select, .monaco-editor";

/**
 * Whether a key event's target types the key rather than taking a shortcut:
 * board text, any field, a code editor. A control inside the board, such as
 * an animation's buttons, is not editable even though the board is.
 */
export const typingIn = (target: EventTarget | null) =>
  target instanceof Element &&
  ((target instanceof HTMLElement && target.isContentEditable) ||
    target.closest(FIELD) !== null);
