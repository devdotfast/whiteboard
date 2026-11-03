# Bounded queue with two workers

A data-driven drawing of a producer, a bounded queue and two workers that shows jobs moving through it under steady load and under a burst that hits the bound.

## Use when

A change introduces or tunes a job queue, a worker pool or a channel with a capacity, and the reviewer needs to see what happens when producers outrun consumers.

## Shows

- Steady load: jobs are put, taken from the head by idle workers, and completed into Done; the queue stays short.
- Burst: the queue fills to its bound, `put()` blocks the producer, a completion frees a slot, and the waiting put goes through.

## Technique

Data-driven. Each frame's `data` holds the full state: the producer's next job and state, the queue contents (head first), the bound, each worker's job and the done list. One `whiteboard.on("*", ...)` handler redraws every card from it, then animates only what changed: it records where each job (`data-job`) was drawn before the redraw and glides it from there with `whiteboard.animate`, fading in jobs that are new. `whiteboard.arrow` draws the edges; the put edge takes `data-tone="removed"` while the producer is blocked. The producer and workers are `data-form="bars"`, parts of this codebase, and the queue a violet `data-form="stack"`, so the silhouettes tell them apart before the titles do.

## Adapt

- Edit only frames.json for new steps or scenarios; the script never names a frame key.
- Change `bound` in the data, or add a worker: a card with id `w3`, its arrow, and a third entry in each frame's `workers`.
- For a queue that drops or rejects instead of blocking, add a producer state with its own note and send the refused job to a "Dropped" well like Done.
- Point `code` in block.json at your put and take paths; the cards open them with `data-wb-open`.
