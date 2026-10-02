# Arch packages

Target: Arch Linux (and derivatives such as Manjaro), x86-64. Stable and
preview install separately as `whiteboard` and `whiteboard-preview`, side by
side with the other Linux packages. All three formats use the same compiled
app and staging code, including the `review` compatibility links.

## Build and check

`bash apps/review-desktop/scripts/package-linux-distributions.sh arch` stages
the shared app and packages it inside a pinned `archlinux:base-devel`
container. `PKGBUILD` extracts the staged install tree without waiting for
an RPM. `makepkg` runs as an unprivileged user; `repo-add` creates unsigned
databases. Signing keys stay on the host.

`build-linux-repository.py`'s `build_arch()` signs the package plus the
`<name>.db` and `<name>.files` databases on the host, through `GNUPGHOME` and
`REVIEW_SIGNING_PASSPHRASE_FILE`, producing binary detached `.sig` files
alongside each. Layout:

- `repos/arch/x86_64/<pkg>` and `<pkg>.sig`
- `repos/snapshots/<generation>/arch/x86_64/<name>.{db,files}` and `.sig`

`linux/verify-repository.sh <publication> arch` installs the package with
`pacman` in a clean pinned Arch container (`verify-arch-container.sh`) and
checks:

- A signed install with `SigLevel = Required DatabaseRequired`, proving
  pacman fetches the detached `.sig` (the database carries no embedded
  signature, since `repo-add` runs before signing).
- The CLI runs, `chrome-sandbox` is `root:root 4755`, and the license file
  is installed.
- The full runtime dependency closure resolves, via `ldd` against the
  hand-maintained `depends=` list.
- Removal deletes the installed app but retains user data under `~/.dev` and
  `~/.config/Review` (reinstall is not exercised).
- A package with corrupted bytes fails the database's checksum check; a
  package with an intact checksum but a tampered `.sig` separately fails its
  PGP signature check; a tampered database fails `DatabaseRequired`; and an
  untrusted signing key is rejected. All four are checked independently.

## Publication contract

The companion `Fix-Fast/dev` update Worker must support pacman before this
release pipeline publishes. The publisher checks `/repos/arch/health` for
`{"schemaVersion":1,"format":"pacman"}`, and requires all four snapshot
database files (`<name>.{db,files}{,.sig}`) to be present before it will
promote the publication.

One channel pointer promotes RPM, APT, and pacman together. `current.json`
gains `"arch": true`. The Worker serves packages immutably and 302s
`repos/arch/x86_64/<name>.{db,files}[.sig]` to the active snapshot while that
flag is set.

After publication, install instructions are at `https://dev.fast/install#linux`
and `https://dev.fast/install/preview#linux`. Users add the key, then the
repository:

```
curl -fsSL https://install.dev.fast/repos/keys/<FPR>.asc | sudo pacman-key --add -
sudo pacman-key --lsign-key <FPR>
```

`/etc/pacman.conf`:

```
[whiteboard]
SigLevel = Required DatabaseRequired
Server = https://install.dev.fast/repos/arch/$arch
```

(preview: section `[whiteboard-preview]`,
`Server = https://install.dev.fast/repos/preview/arch/$arch`), then
`sudo pacman -Syu whiteboard` (or `whiteboard-preview`). The `.pkg.tar.zst`
and its detached `.sig` are also attached to the stable GitHub release next to
the RPM and .deb. `pacman -U <url>` only works after the key above has been
added and lsigned; pacman's default `SigLevel` requires that signature, and
the release asset has no embedded one.

## AUR

Not published. AUR registration was closed ("temporarily closed") when this
repository was built, on 2026-09-28. This repository replaces the former
`whiteboard-bin` AUR recipe.
