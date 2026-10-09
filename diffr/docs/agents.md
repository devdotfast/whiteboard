Plugins Guide (for agent readers, not humans):

Use this guide when a person asks you to change how diffr shows their diffs:
"collapse X", "hide Y files", "show more context", "label Z". There are two
approaches:

1. **Preferred: set a field on a bundled plugin.** diffr's bundled plugins
   already cover most requests. Check their fields first.
2. **Otherwise: write a plugin yourself.** Build it, add it to the config, and
   test it on a diff before you hand it over.

## Approach 1 (preferred): set a field on a bundled plugin

The bundled plugins, in their default order:

| Plugin | What it does |
|---|---|
| `bundled.deleted-bodies` | Collapses function bodies that were deleted outright. |
| `bundled.summarize` | Replaces large new function bodies and tests with LLM pseudocode summaries. Off unless the person set it up. |
| `bundled.test-bodies` | Collapses test bodies and test modules, so the code under test reads first. |
| `bundled.removed-runs` | Collapses the middle of long removed stretches. |
| `bundled.context` | Folds every unchanged stretch into one row, keeping lines around each change and the enclosing headers. This is the plain "show me the diff" view. |

The bundled classifier, `plugins.classify.bundled`, runs before all of them. It
tags each file as `generated`, `vendored`, `docs`, `test`, `integration` or
`e2e`, from GitHub Linguist's rules, test-path rules and git attributes, and
hides some of them.

Many requests need only a setting on a bundled plugin. Set one with
`diffr config set <key> <value>`, for example
`diffr config set plugins.shape.bundled.context.lines 8`. Every plugin also has
`enabled` (true or false). `diffr config schema` lists every setting, with its
type, default and description; `diffr config show --json` shows the values in
use. The bundled plugins' settings:

| Key (under `plugins.shape.bundled.` or `plugins.classify.bundled.`) | Default | What it does |
|---|---|---|
| `context.lines` | 3 | Unchanged lines kept on each side of a change. `-U` overrides it for one run. |
| `deleted-bodies.min_lines` | 12 | Deleted bodies shorter than this stay open. |
| `removed-runs.min_lines` | 5 | Removed stretches shorter than this stay open. |
| `test-bodies.min_lines` | 3 | Test bodies shorter than this stay open. |
| `summarize.enabled` | false | LLM pseudocode summaries of large new bodies and tests. Needs a key. |
| `summarize.provider` | `gemini` | `gemini`, `openai` or `anthropic`. Changing it clears `api_key`. |
| `summarize.model` | the provider's | The model name sent to the provider. |
| `summarize.api_key` | unset | Without it, the provider's variable in the environment is used: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. |
| `summarize.endpoint` | the provider's | Another base URL: a proxy, OpenRouter, or a local OpenAI-compatible server with `provider = "openai"`. |
| `summarize.min_lines` | 20 | New bodies shorter than this are shown as code. |
| `summarize.tests` | true | Summarize new test bodies too. |
| `summarize.test_min_lines` | 20 | Shorter test bodies keep their ordinary labels. |
| `summarize.system_prompt` | built in | The instruction sent with each body. Change it to change the style of the summaries. |
| `summarize.request_timeout_ms` | 60000 | Timeout for each request. |
| `summarize.retries` | 3 | Retries after a timeout, rate limit or server error. |
| `classify.hide` | `["generated", "vendored"]` | A file with any of these tags starts hidden. Tags: `generated`, `vendored`, `docs`, `test`, `integration`, `e2e`. |
| `classify.hide_deleted` | true | Hide files that were deleted outright. |

For example, "hide test files" is `diffr config set plugins.classify.bundled.hide '["generated","vendored","test"]'`,
and "show more context" is `plugins.shape.bundled.context.lines`. Write a
plugin only when no field does it.

## Approach 2: write a plugin

### 1. Pick the kind of plugin

| The request is about | Kind | What it decides |
|---|---|---|
| whole files ("hide lockfiles", "tag schema files") | classify | Tags for each changed file, and whether to hide the file. Runs before diffing. |
| code inside files ("collapse logging", "fold test setup") | shape | Which regions start collapsed, their labels, and how regions group. Runs after diffing. |

There is only one classifier (limitation of diffr API; if the user complains, please file an issue!). 
A custom classifier replaces the bundled one, which tags generated, vendored, docs and test files. Prefer a shape plugin,
unless the person asks about whole files.

### 2. Make the plugin folder

```
my-plugin/
  plugin.toml        name, title, options, query files
  plugin.wasm        the built component
  queries/rust.scm   fold queries, one file for each language (shape only)
  Cargo.toml         the source; diffr reads only the three files above
  src/lib.rs
```

`plugin.toml`:

```toml
name = "todo-bodies"         # also the tag prefix: "todo-bodies:<name>"
title = "TODO bodies"
description = "Collapse function bodies that contain TODO."

# Optional. Without it, the plugin is on, under the switch "Run <title>".
# [enabled]
# title = "Collapse TODO bodies"
# default = false

[options.label]              # a JSON Schema for each option
type = "string"
title = "Label"              # each option needs a title
default = "has a TODO"

[queries]                    # shape plugins only
rust = "queries/rust.scm"
```

Language keys are the names from `diffr debug --list-languages`, in lowercase,
with no spaces: `rust`, `python`, `go`, `javascript`, `javascriptjsx`,
`typescript`, `typescripttsx`. `enabled` and `path` are diffr's keys. An
option can't use either name.

### 3. Write the fold queries (shape)

Queries are tree-sitter queries. They select the regions your plugin sees, and
they tag those regions. To find the node names, parse a sample file:

```sh
diffr debug --dump-ts sample.rs
```

```scheme
; inherits: builtin:core/queries/rust/folds.scm
((function_item body: (block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#set! tag "todo-bodies:body"))
```

- `@fold` is the region: the whole node.
- To fold only the inside, capture the delimiters as `@fold.open` and
  `@fold.close`. Each `@fold.open` needs exactly one `@fold.indent`: the
  first node of the body.
- `#set! tag "<plugin>:<name>"` tags the region. The prefix must be your
  plugin's `name`.
- Helper captures start with `_`, e.g. `@_attribute` for a `#match?`.
- Other captures and directives are errors.
- `; inherits:` imports other query files first. Use `builtin:core/queries/<language>/folds.scm`
  for the standard folds, or a path relative to your file.
- Tags only mark regions. Your plugin code decides what collapses.

### 4. Write the code

Write a Rust crate built for `wasm32-wasip2`. Use the SDK from the same
release as the person's diffr: `diffr --version` prints `diffr X.Y.Z`, and
the tag is `diffr/X.Y.Z`. Don't use `diffr-plugin-sdk` from crates.io: it is an
older, different API.

```toml
[package]
name = "todo-bodies"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
diffr-plugin-sdk = { git = "https://github.com/devdotfast/whiteboard", tag = "diffr/X.Y.Z" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

A shape plugin:

```rust
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Options {
    label: String,
}

struct TodoBodies {
    options: Options,
}

impl Guest for TodoBodies {
    type Plugin = Self;
}

impl GuestPlugin for TodoBodies {
    /// `options` is the entry's options as JSON, already checked against
    /// plugin.toml, with defaults filled in. An error stops diffr's setup.
    fn new(options: String) -> Result<Self, String> {
        let options = serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        Ok(Self { options })
    }

    /// Called for each region, before (`Pre`) and after (`Post`) its children.
    /// Ok(false) on Pre skips the children and Post. An error ends this file's traversal.
    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        if phase != Visit::Pre {
            return Ok(true);
        }
        let id = cursor.id();
        let data = cursor.get(id)?.data;
        if data.tags.iter().any(|tag| tag == "todo-bodies:body") && cursor.text(id)?.contains("TODO") {
            cursor.set_collapsed(id, true)?;
            cursor.set_label(id, Some(&self.options.label))?;
        }
        Ok(true)
    }
}

export_shape!(TodoBodies);
```

The cursor gives you:

- **Read:** `file()` (paths, status, the classifier's tags), `id()`,
  `get(id)` (range, tags, visibility, leaf or fold, children), `text(id)`,
  `source(side)`, `siblings(id)`, `ancestors(id)`, `has_changes(id)`,
  `is_one_sided(id)`, `paired_leaf(id)`, `linked_regions(id)`,
  `matching_siblings(ids)`, `leaves(side, start, end)`, and `display(id)`.
- **Edit:** `set_collapsed(id, bool)`, `set_label(id, Option<&str>)`,
  `link(ids)` (collapse together), `join(ids)` (wrap siblings in a new fold),
  and `cut(id, offset)` (split a leaf).
- **Repository:** `git::check_attr(attributes, path)` and `git::cat_file(object)`.

For the exact types, see `wit/plugin.wit` in the diffr source at the same tag.

A classifier implements `GuestClassifier` instead:

```rust
use diffr_plugin_sdk::prelude::*;

struct Schemas;
impl ClassifierGuest for Schemas {
    type Classifier = Self;
}
impl GuestClassifier for Schemas {
    fn new(_options: String) -> Result<Self, String> {
        Ok(Self)
    }
    fn classify(&self, file: FileEntry) -> Result<Classification, String> {
        let path = match &file.file {
            FileSides::Both((_, after)) | FileSides::RightOnly(after) => &after.path,
            FileSides::LeftOnly(before) => &before.path,
        };
        let tags = if path.ends_with(".schema.json") {
            vec![Tag::Custom("schema".into())]
        } else {
            Vec::new()
        };
        // `hidden: Some(reason)` hides the file: diffed by line, not shaped, shown collapsed.
        Ok(Classification { tags, hidden: None })
    }
}
export_classifier!(Schemas);
```

### 5. Build

```sh
rustup target add wasm32-wasip2      # once
cargo build --release --target wasm32-wasip2
cp target/wasm32-wasip2/release/todo_bodies.wasm plugin.wasm
```

Copy the `.wasm` to `plugin.wasm` again after each build. diffr reads only
`plugin.wasm`.

### 6. Add it to a config

Test with a scratch config first, so the person's own config stays as it is.
`DIFFR_CONFIG_DIR` points diffr at another config directory:

```sh
mkdir -p /tmp/diffr-test
diffr config show --json    # read plugins.shape.order: the bundled plugins
```

`/tmp/diffr-test/config.toml`:

```toml
version = 2

[plugins.shape]
# The whole list: keep the bundled plugins in it (see below).
order = ["bundled.deleted-bodies", "bundled.summarize", "bundled.test-bodies",
         "bundled.removed-runs", "todo-bodies", "bundled.context"]

[plugins.shape.todo-bodies]
path = "/abs/path/to/my-plugin"   # or relative to this config file
label = "has a TODO"              # options go next to path
```

`order` works like a middleware chain. Each file's region trees pass through
the plugins in this order, and each plugin sees, and can change, what the ones
before it did. An explicit `order` is the whole chain: a plugin that isn't in it
doesn't run: a bundled plugin left out is off, and an entry you declared but
left out is an error. So copy the bundled entries from `diffr config show --json`
and insert yours.

The bundled plugins are described under Approach 1.

Put your plugin before `bundled.context`, as above. `context` skips any region an
earlier plugin collapsed, and keeps open the fold around it, so your label
shows. A plugin after `context` sees trees `context` has already cut and
folded. Leave the bundled plugins and their order alone unless the person asks:
removing or reordering them, `context` above all, changes every diff they see,
not only the cases your plugin is for.

The entry's name must equal `name` in `plugin.toml`. A classifier goes under
`[plugins.classify.<name>]` with a `path` instead, and replaces
`[plugins.classify.bundled]`.

### 7. Test it

Turn the person's request into two small files: a "before" file, and an
"after" file with the changes the plugin should act on. Then diff them
without a repository:

```sh
DIFFR_CONFIG_DIR=/tmp/diffr-test diffr --no-index before.rs after.rs --format ndjson > out.ndjson
```

Check `out.ndjson`:

- A region your plugin collapsed has `"visibility":{"collapsed":true,"label":"<your label>"}`.
- Your tags are in the regions' `"tags"`. If a tag is missing, the query didn't match.
- A query problem is in the file's `"error":{"code":"query_error",...}`, and
  diffr still exits 0. Search the output for `"error"`.
- A problem with the config or the plugin itself, such as bad options, a
  missing `plugin.wasm` or a wrong name, stops diffr with a message.

To read the result as a diff, run `diffr pprint out.ndjson`. Collapsed regions
show as `… collapsed …` rows.

Then try it on the person's real change:
`DIFFR_CONFIG_DIR=/tmp/diffr-test diffr <revisions> --format ndjson`.

### 8. Hand it over

When it works, add the `[plugins.shape.<name>]` entry and the new `order` to
the person's config: `$DIFFR_CONFIG_DIR/config.toml` when that is set,
otherwise `~/.config/diffr/config.toml`. Tell them where the plugin folder is,
and that `enabled = false` in its entry turns it off.
