// Grammar-only languages built into Whiteboard Desktop.
//
// Each entry names a grammar from the pinned `tm-grammars` devDependency and
// the language it colors. `license` overrides tm-grammars when it has none;
// GPL grammars are refused. Entries without `grammar` add file names to a
// language Code OSS already highlights.
//
// To add a language or bump tm-grammars, edit this file, then run
//   pnpm --filter @dev.fast/review-desktop grammars:sync
// which regenerates code-oss/extensions/review-grammars.

const slash = { lineComment: "//", blockComment: ["/*", "*/"] };

const hash = { lineComment: "#" };

const lisp = { lineComment: ";", blockComment: ["#|", "|#"] };

export const reviewGrammars = Object.freeze([
  {
    grammar: "apex",
    language: "apex",
    license: "BSD-3-Clause",
    aliases: ["Apex"],
    extensions: [".apexc", ".trigger"],
    comments: slash,
  },
  {
    grammar: "asm",
    language: "asm",
    aliases: ["Assembly"],
    extensions: [".asm", ".s", ".S"],
    comments: { lineComment: ";" },
  },
  {
    grammar: "cmake",
    language: "cmake",
    aliases: ["CMake"],
    extensions: [".cmake", ".cmake.in"],
    filenames: ["CMakeLists.txt"],
    comments: hash,
  },
  {
    grammar: "common-lisp",
    language: "commonlisp",
    aliases: ["Common Lisp"],
    extensions: [".lisp", ".lsp", ".asd"],
    comments: lisp,
  },
  {
    grammar: "elixir",
    language: "elixir",
    license: "Apache-2.0",
    aliases: ["Elixir"],
    extensions: [".ex", ".exs"],
    comments: hash,
  },
  {
    grammar: "elm",
    language: "elm",
    aliases: ["Elm"],
    extensions: [".elm"],
    comments: { lineComment: "--", blockComment: ["{-", "-}"] },
  },
  {
    grammar: "erlang",
    language: "erlang",
    aliases: ["Erlang"],
    extensions: [
      ".erl",
      ".hrl",
      ".app.src",
      ".escript",
      ".xrl",
      ".yrl",
    ],
    filenames: ["Emakefile", "rebar.config", "rebar.config.lock", "rebar.lock"],
    comments: { lineComment: "%" },
  },
  {
    grammar: "fortran-free-form",
    language: "fortran",
    aliases: ["Fortran"],
    extensions: [".f90", ".F90", ".f95", ".f03", ".f08"],
    comments: { lineComment: "!" },
  },
  {
    grammar: "fortran-fixed-form",
    language: "fortran-fixed",
    aliases: ["Fortran (fixed form)"],
    extensions: [".f", ".for", ".F", ".FOR"],
    comments: { lineComment: "!" },
  },
  {
    grammar: "gleam",
    language: "gleam",
    aliases: ["Gleam"],
    extensions: [".gleam"],
    comments: { lineComment: "//" },
  },
  {
    grammar: "haskell",
    language: "haskell",
    aliases: ["Haskell"],
    extensions: [".hs"],
    comments: { lineComment: "--", blockComment: ["{-", "-}"] },
  },
  {
    grammar: "hcl",
    language: "hcl",
    aliases: ["HCL"],
    extensions: [".hcl", ".nomad"],
    comments: { ...hash, blockComment: ["/*", "*/"] },
  },
  {
    grammar: "kotlin",
    language: "kotlin",
    aliases: ["Kotlin"],
    extensions: [".kt", ".ktm", ".kts"],
    comments: slash,
  },
  {
    grammar: "nix",
    language: "nix",
    aliases: ["Nix"],
    extensions: [".nix"],
    comments: { ...hash, blockComment: ["/*", "*/"] },
  },
  {
    grammar: "ocaml",
    language: "ocaml",
    aliases: ["OCaml"],
    extensions: [".ml", ".mli"],
    comments: { blockComment: ["(*", "*)"] },
  },
  {
    grammar: "pascal",
    language: "pascal",
    aliases: ["Pascal"],
    extensions: [".pas", ".dfm", ".dpr", ".lpr", ".pascal"],
    comments: { lineComment: "//", blockComment: ["{", "}"] },
  },
  {
    grammar: "proto",
    language: "proto",
    aliases: ["Protocol Buffers"],
    extensions: [".proto"],
    comments: slash,
  },
  {
    grammar: "qml",
    language: "qml",
    aliases: ["QML"],
    extensions: [".qml"],
    comments: slash,
  },
  {
    grammar: "scala",
    language: "scala",
    aliases: ["Scala"],
    extensions: [".scala", ".sbt", ".sc"],
    comments: slash,
  },
  {
    grammar: "scheme",
    language: "scheme",
    aliases: ["Scheme"],
    extensions: [".scm", ".sch", ".ss"],
    comments: lisp,
  },
  {
    grammar: "solidity",
    language: "solidity",
    aliases: ["Solidity"],
    extensions: [".sol"],
    comments: slash,
  },
  {
    grammar: "system-verilog",
    language: "systemverilog",
    aliases: ["SystemVerilog"],
    extensions: [".sv", ".svh"],
    comments: slash,
  },
  {
    grammar: "terraform",
    language: "terraform",
    aliases: ["Terraform"],
    extensions: [".tf", ".tfvars"],
    comments: { ...hash, blockComment: ["/*", "*/"] },
  },
  {
    grammar: "toml",
    language: "toml",
    license: "TextMate bundle license",
    aliases: ["TOML"],
    extensions: [".toml"],
    filenames: [
      "Cargo.lock",
      "Gopkg.lock",
      "Pipfile",
      "pdm.lock",
      "poetry.lock",
      "uv.lock",
    ],
    comments: hash,
  },
  {
    grammar: "verilog",
    language: "verilog",
    aliases: ["Verilog"],
    extensions: [".v", ".vh"],
    comments: slash,
  },
  {
    grammar: "vhdl",
    language: "vhdl",
    aliases: ["VHDL"],
    extensions: [".vhd", ".vhdl"],
    comments: { lineComment: "--" },
  },
  {
    grammar: "zig",
    language: "zig",
    aliases: ["Zig"],
    extensions: [".zig", ".zon"],
    comments: { lineComment: "//" },
  },
  { language: "clojure", extensions: [".bb", ".boot", ".clje"] },
  { language: "cpp", extensions: [".tcc"] },
  { language: "javascript", extensions: [".snap"] },
  {
    language: "json",
    extensions: [
      ".avsc",
      ".gltf",
      ".mcmeta",
      ".tfstate",
      ".tfstate.backup",
      ".topojson",
    ],
    filenames: [
      ".arcconfig",
      ".c8rc",
      ".nycrc",
      ".tern-config",
      ".tern-project",
      "flake.lock",
      "Pipfile.lock",
    ],
  },
  {
    language: "makefile",
    extensions: [".make", ".makefile", ".mkfile"],
    filenames: [
      "BSDmakefile",
      "Kbuild",
      "Makefile.am",
      "Makefile.inc",
      "mkfile",
    ],
  },
  { language: "php", extensions: [".php3", ".php7", ".phps"] },
  {
    language: "python",
    extensions: [".bzl", ".py3"],
    filenames: ["BUCK", "TARGETS"],
  },
  { language: "r", extensions: [".rsx"] },
  { language: "ruby", extensions: [".builder"] },
  {
    language: "shellscript",
    extensions: [".bats", ".command", ".tmux"],
    filenames: [".kshrc", "gradlew"],
  },
  { language: "sql", extensions: [".pgsql"] },
  {
    language: "xml",
    extensions: [".ant", ".mjml", ".plist", ".resx", ".zcml"],
    filenames: [
      ".classpath",
      ".cproject",
      ".project",
      "App.config",
      "nuget.config",
      "packages.config",
    ],
  },
  { language: "yaml", filenames: ["yarn.lock"] },
]);
