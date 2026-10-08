# Terminal frontend provenance

Imported unchanged from https://github.com/modem-dev/hunk at f86a04ed0325e641d7d96067992f14849016ec8b.
Upstream MIT license is retained in tui/LICENSE.
Import and subsequent refactoring performed with AI assistance.

Additional restored primitives: `ui/lib/sidebar.ts` is copied unchanged from Hunk;
`ui/lib/keys.ts` restores Hunk's `extension-api/keys.ts` with only its
structural input type inlined to avoid depending on the extension system.
Navigation defaults follow Hunk's command catalog; diffr also accepts Ctrl-F/Ctrl-B
and h/l. Cmd-B toggles the tree, with backslash as the unmodified fallback
because Hunk uses b for page-up.
