# How a video gets from upload to playback

An architecture scene: the client, the edge, our services and our storage as four groups, with an upload walking down through them and a playback walking back out through the CDN.

## Use when

A change moves work between layers of a system: a new service, a queue between two steps, a cache in front of storage, a third party taking over a step. The reviewer needs to see which layer owns each step and where a request leaves our code.

## Shows

- Upload: the gateway routes to the upload service, the original lands in blob storage, a transcode job waits in a queue, a worker renders renditions and the catalog marks the video ready.
- Playback: the catalog resolves a manifest, the app fetches segments from the CDN, and the first fetch in a region misses to blob storage; later ones never touch our services.
- Each layer is a `group`; each card wears its kind as a `form`; the storage cards share `teal`; the queue is `violet`; the CDN, which we do not run, is dashed. A `legend` decodes them.

## Technique

A scene of three columns and three rows. `s.group` draws the four layers behind their cells: the client in `accent`, the edge plain, services plain, storage in `teal`. Cards take `form`: `window` for the app, `bars` for our services, `drum` with `outline: "dashed"` for the CDN, `cylinder` for the stores and `stack` for the queue. One `send` per frame carries the request or the data between layers; `on` changes notes and tones as a layer takes over; `highlight` rings the card doing the work. `s.legend` lists the six marks once, under the scene.

## Adapt

- Rename the layers and cards to your system; keep three or four columns so the groups stay one row each and edges stay short. Twelve nodes in four columns tangle; nine in three read.
- Put each real step's range in `code` and name it on the frames that show it.
- A layer with one card still deserves its group when the boundary is the point.
- Keep one `send` per frame; a step that fans out is two frames.
