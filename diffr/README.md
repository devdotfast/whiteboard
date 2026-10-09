# diffr

> diffr is experimental and still in alpha.

diffr is a Rust-based structural diffing (AST-aware) library with a WASM plugin system. It also has an:

1. Interactive TUI with AST-aware code folding

   ![AST-aware code folding in the diffr TUI](docs/images/folding.gif)

2. Sane defaults for AI coding
   - Summarize long changes as pseudocode
   - Collapse tests and docs

   ![Long changes summarized as pseudocode in the diffr TUI](docs/images/pseudocode.gif)

3. [WASM-based plugin system](docs/plugin.md)

4.  Diffr is also available natively in many coding agents as a native plugin via `/diffr`. You can view and comment on diffs without switching tabs:

// TODO(smenon): gif of claude code plugin

Currently, we support plugins for the following: Claude Code, Codex, Pi, Opencode V2, and any harness which runs inside Herdr.

## Usage

`diffr` accepts the exact same arguments that `git diff` does.

```sh
diffr                         # index versus working tree
diffr --cached                # staged changes
diffr main...HEAD -- src/      # merge-base comparison
```

## Installation

### Install Script (Preferred)

Run the script below + follow its setup instructions:

```sh
curl -fsSL https://install.dev.fast/diffr | sh
```

### Alternative Methods:

You can use homebrew (Apple Silicon macOS, Intel macOS, and x64/ARM64 Linux):

```sh
# Install the CLI + TUI
brew install devdotfast/tap/diffr
# Install in-coding agent diff viewing experiences:
diffr config init
```

The CLI, from crates.io (prebuilt via [cargo-binstall](https://github.com/cargo-bins/cargo-binstall), or compiled):

```sh
cargo binstall diffr-cli
cargo install diffr-cli --locked
```

Windows x64: download `diffr-<version>-<target>.tar.gz` from [Whiteboard Releases](https://github.com/devdotfast/whiteboard/releases) and extract it with `tar -xzf`, or use `cargo binstall`.

## History

diffr is sourced heavily from two other great open-source projects:

1. The lovely [difftastic](https://github.com/Wilfred/difftastic)(MIT, Wilfred Hughes), which powers its structural diffing algorithm.
2. Its terminal UI was taken from [hunk](https://github.com/modem-dev/hunk) (MIT, Modem Labs), which itself uses OpenTUI.

We forked these projects because of the following 3 technical reasons:

1. AST-based fold matching: we didn't want just structural diffing; with the power of tree-sitter queries, you can also match AST *folds* across new/old files and get a more intuitive review experience:
// TODO(cld/sid): need a gif here.
2. Plugin System: We started to review lightweight diffs but realized that every language, team, and developer was different. We're striving towards the ideal where you can customize your own review - for example, filter to only files and types which are important to you.
  - By default, we have plugins set up that collapse unit tests, and summarize long code blocks in pseudocode.
3. TUI affordance - for small diffs it's too heavyweight to have a full review app, or even github. We kept things in Typescript for the MVP here; this will be rewritten in pure Rust.

We hope in the future that we can find some way to upstream some / all of these features. Obviously everyone works differently and this is quite an opinionated stance on things, so we imagine this may take time.

## Known Limitations

1. Semantic diff summarization calls Gemini, OpenAI (or any OpenAI-compatible server, such as Ollama, via `endpoint`), or Anthropic. Onboarding guides you on getting it set up (via script or `diffr config init`). but otherwise:
  a. Through the TUI:
    - Run `diffr config`
    - Search for 'summarization'
    - Enable in the dropdown
    - Pick a provider and model, and add its API key unless `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is already in your environment
  b. Through `Cmd + P > Settings` in the [Whiteboard app](../).
2. The plugin API is a bit awkward and will be simplified radically in the coming releases.

### Plugin API

`diffr` has a powerful, wasm-based plugin API which customizes how it presents changed files. For more details, read the [docs](./docs/plugin.md).

TODO: move this probably to the plugins dir?? and update the reference. probably sjould just be a README.md?

## License

MIT. See `LICENSE` for the terms and `NOTICE` for the third-party work
diffr builds on, starting with the lovely
[difftastic](https://github.com/Wilfred/difftastic).
