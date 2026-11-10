# Sequence

Who calls whom over time, as a sequence diagram would show it: participants in a row, and each step a call or a reply riding between two of them.

## Use when

The interesting part is the order of calls and replies between a few participants: a login handshake, a retry, an async handoff through a queue.

## Shows

- Four participants left to right: the browser, the API, the auth service and the session store.
- Each step is one call or reply; replies ride back against the wire and are drawn outlined.
- The queue handoff is a dashed wire, since nobody waits on it.

## Technique

Participants are nodes in one row (`wb.layout({ direction: "right" })` keeps the order they were drawn in when wires run left to right). Each step is a frame with one move; a move against its wire is a reply. Steps name the line that makes the call in `code`.

## Adapt

- Four or five participants at most; group the rest.
- One call per step. A reply gets its own step when the reader must see it arrive.
- An asynchronous handoff gets a dashed wire and a step of its own.
