# Fan-out

One event fanned out to three subscribers, placed by hand: the publisher on the left, the broker in the middle as tall as the column of subscribers on the right. Each subscriber's wires carry a delivery and an ack, and one carries a retry as well. A panel under the drawing shows each delivery's state.

## Use when

One node sends to several and hears back from each: a broker and its subscribers, a coordinator and its participants, a load balancer and its backends. The point is what each of them answers.

## Shows

- Every delivery acked: the order service publishes, the broker delivers to billing, email and the audit log, and each acks.
- Email retried: billing and the audit log ack, email times out, and the broker delivers again before email acks.
- The panel under the drawing shows each subscriber's delivery state on every step.

## Technique

`diagram.js` places the subscribers in a column 100px apart and makes the broker as tall as the column, so the broker's side spans every subscriber and each wire runs straight across. Each subscriber's wires run side by side 12px apart: the outer two labels sit outside their wires and the retry's stays on its own. The columns are 84px apart, room for a label of about 7 characters, and the subscribers' group has a padding of 12 so the labels stay clear of its edge. The ack that never comes is a move with `lost: true`, which stops halfway. Each frame's `data` fills the panel from `wb.onFrame`.

## Adapt

- Make the node that fans out as tall as the column it fans out to, so its wires run straight.
- Keep labels on a fan-out's wires to a word; say the rest in the caption.
- Run three or more wires between one pair side by side across, not down.
- Mark a message that never arrives with `lost: true`, and one that arrives with bad news with `failed: true`.
