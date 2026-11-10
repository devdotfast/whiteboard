# Pele's layout, vendored

`pele-layout.global.js` is the layered and compound layout from
[Pele](https://github.com/obsidianmd/pele) (MIT, see `LICENSE`), built from
`src/layout/compound.ts` and `src/layout/layered.ts` at commit `3a2f075`. The
package does not export them, so they are bundled here and sent to a
diagram's stage as text, as ELK is.

It defines `peleLayout.cnode` and `peleLayout.compoundLayout` on the global.
To rebuild, bundle an entry that imports the two from `src/layout/compound.js`
and assigns them to `globalThis.peleLayout`, with
`esbuild --bundle --format=iife --minify`.
