# Played request

A request animated end to end as one timeline the reader plays, pauses and scrubs, with chapters to jump between: the timing itself is the point.

## Use when

How long each hop takes matters more than the discrete states: a timeout firing while a reply is on its way, a slow dependency holding a request, a cache saving a round trip.

## Shows

- A request leaves the client, waits on a slow service, and the client's timeout fires before the reply lands.
- Chapters: the call, the wait, the timeout, the late reply.

## Technique

`block.json` holds a `timeline` of chapters with durations instead of frames. The script draws the moment it is given in `wb.onTime((time, moment) => ...)`: a token placed along a wire by how far through its chapter the playhead is, and states set for the chapter. Time can jump either way, so each moment is drawn whole from `moment`.

## Adapt

- Keep chapters to a few seconds each; their titles show in the strip.
- Draw from the moment, never from what the previous call drew.
- Use frames with moves instead when the reader compares states rather than timing.
