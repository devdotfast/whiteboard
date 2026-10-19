# Configuration

Git attributes and diffr's config file change which files a diff shows.

## Hidden files

Whiteboard hides files that GitHub Linguist marks as generated or vendored.
Git attributes take precedence over the config file.

### Git attributes

To show a path that Linguist marks as vendored, add an attribute to the root
`.gitattributes`. To keep the change local, add it to `.git/info/attributes`.

```text
**/presentation/external/** linguist-vendored=false
```

`linguist-generated=false` works the same way for generated files.

### Hide files by tag

To stop hiding vendored files in every repository, open Settings and change
**Hide files by tag**. The setting is saved in `~/.config/diffr/config.toml`:

```toml
[plugins.classify.bundled]
hide = ["generated"]
```

Reopen the review after you edit either file.
