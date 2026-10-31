# UI rules

The `ui-inspector` checks every rule here, plus the **Feature rules** in the
plan, against screenshots of the running Desktop. Each rule must be decidable
from screenshots and the `shot` output alone. Add a rule when a review catches
something the inspector should have; keep them concrete.

## Layout and spacing

1. Siblings in a row or column share one gap; no gap differs by a pixel from
   its neighbours.
2. Text baselines and icon centers in a row line up.
3. Edges of related surfaces (cards, rows, inputs) align to the same x.
4. Nothing overflows its container or causes a horizontal scrollbar, in the
   default size or at `--size 700x900`.
5. Long text truncates with an ellipsis or wraps on purpose; it never clips
   mid-glyph or overlaps another element.
6. At the narrow size the layout follows the narrow breakpoint (stacked or
   condensed) rather than squeezing the wide layout.

## Type and color

7. Type sizes and weights match the neighbouring kit components; no one-off
   sizes.
8. Every color follows the theme: switching light/dark changes every surface,
   border, text and icon, and nothing stays light-on-light or dark-on-dark.
9. Text and icons keep readable contrast against their surface in both themes.
10. Secondary text is visibly secondary, but never so faint it reads as
    disabled.

## Interaction

11. Every interactive element is reachable with Tab in visual order, shows a
    visible focus ring when focused from the keyboard, and the `focused`
    output names it with a role or label.
12. Hover changes appearance without moving layout by any amount.
13. Overlays (popovers, dialogs, menus) close on Escape and focus returns to
    the element that opened them.
14. A focused control that still works is never shown disabled.
15. Errors inside a modal show inline in the modal, not only as a
    notification.
16. Overlays stack above the content they belong to and below host
    notifications.

## Motion

17. With `--motion reduce`, nothing slides, scales or fades longer than a
    brief opacity change; the end state matches the animated end state.
18. Transitions between states have no flash of unstyled or empty content.

## Health

19. `shot` reports no console errors caused by the feature.
