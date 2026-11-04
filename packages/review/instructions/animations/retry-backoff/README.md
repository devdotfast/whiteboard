# Retry with exponential backoff

Attempts from a caller to a service on a time axis in seconds, with waits that double between them, in one path that succeeds on the third attempt and one that gives up after the maximum.

## Use when

A change adds or tunes a retry loop: the base delay, the multiplier, the attempt cap, or which errors count as retryable, and the reviewer needs to see when each attempt actually lands and how long the caller can be held.

## Shows

Each attempt drops a request from the caller lane to the service lane and lands a status chip. Between attempts, a wait line grows along the caller lane, its length proportional to the delay, against an axis ticked in seconds. One scenario ends with a 200 at 3s; the other runs four attempts and throws at 7s.

## Technique

A scene in hand-made HTML: the script lays attempts and waits out from two small arrays, positioning each by its time in seconds (`--t`). Each is tied to its frame with `data-enter`; `whiteboard.arrow` links an attempt's caller marker to its result, `whiteboard.travel` moves one `GET` token along it, and `whiteboard.timeline(frame)` reveals the result and grows the wait line, so a jump or reduced motion lands on the end state. Attempt markers carry `data-wb-open="retry"` and waits `data-wb-open="backoff"`; each frame's `code` lists the range it explains.

## Adapt

- Edit `attempts` and `waits` to your schedule: a different base, factor or cap, or jitter (give each wait its real `span`). Keep the axis domain (`8` in the CSS and the tick loop) just past the last attempt.
- Rename the status chips and the token label to your protocol, such as a gRPC code or a queue redelivery.
- Add a scenario for another branch, such as a non-retryable 400 that fails at once, as new frames and one new entry in `attempts`.
- Point `code` in block.json at your loop and delay function.
