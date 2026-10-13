//! Link the pinned grammars with their parse tables compressed.
//!
//! Tree-sitter generates each grammar as one `parser.c`: constant tables plus a
//! lexer. This script packs every table whose elements are plain data. It reads
//! the table's bytes from an object file compiled for the target, stores them
//! as zstd bytes, and leaves an empty array in its place. A generated C
//! function, `diffr_unpack_<symbol>`, fills the arrays, and `src/lib.rs` runs it
//! once before the grammar's first use.
//!
//! A wasm32 build compiles each grammar as generated, with an empty unpack
//! function: a page is served compressed, so packing would only cost the
//! decompressor, and wasm object files hold their tables in a form this
//! script does not read.
use object::{Object, ObjectSection, ObjectSymbol};
use rayon::prelude::*;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::process::Command;

// Grammar crates: (constructor symbol, crate name, source folder).
const PACKAGES: &[(&str, &str, &str)] = &[
    ("tree_sitter_go", "tree-sitter-go", "src"),
    ("tree_sitter_javascript", "tree-sitter-javascript", "src"),
    ("tree_sitter_python", "tree-sitter-python", "src"),
    (
        "tree_sitter_rust_orchard",
        "tree-sitter-rust-orchard",
        "src",
    ),
    (
        "tree_sitter_typescript",
        "tree-sitter-typescript",
        "typescript/src",
    ),
    ("tree_sitter_ada", "tree-sitter-ada", "src"),
    ("tree_sitter_apex", "tree-sitter-sfapex", "apex/src"),
    ("tree_sitter_asm", "tree-sitter-asm", "src"),
    ("tree_sitter_bash", "tree-sitter-bash", "src"),
    ("tree_sitter_c", "tree-sitter-c", "src"),
    ("tree_sitter_c_sharp", "tree-sitter-c-sharp", "src"),
    (
        "tree_sitter_clojure_orchard",
        "tree-sitter-clojure-orchard",
        "src",
    ),
    ("tree_sitter_cmake", "tree-sitter-cmake", "src"),
    ("tree_sitter_commonlisp", "tree-sitter-commonlisp", "src"),
    (
        "tree_sitter_containerfile",
        "tree-sitter-containerfile",
        "src",
    ),
    ("tree_sitter_cpp", "tree-sitter-cpp", "src"),
    ("tree_sitter_css", "tree-sitter-css", "src"),
    (
        "tree_sitter_dart_orchard",
        "tree-sitter-dart-orchard",
        "src",
    ),
    ("tree_sitter_devicetree", "tree-sitter-devicetree", "src"),
    ("tree_sitter_elisp", "tree-sitter-elisp", "src"),
    ("tree_sitter_elixir", "tree-sitter-elixir", "src"),
    ("tree_sitter_elm", "tree-sitter-elm", "src"),
    ("tree_sitter_erlang", "tree-sitter-erlang", "src"),
    ("tree_sitter_fish", "tree-sitter-fish", "src"),
    ("tree_sitter_fortran", "tree-sitter-fortran", "src"),
    ("tree_sitter_fsharp", "tree-sitter-fsharp", "fsharp/src"),
    ("tree_sitter_gleam", "tree-sitter-gleam", "src"),
    ("tree_sitter_haskell", "tree-sitter-haskell", "src"),
    ("tree_sitter_hcl", "tree-sitter-hcl", "src"),
    ("tree_sitter_html", "tree-sitter-html", "src"),
    (
        "tree_sitter_java_orchard",
        "tree-sitter-java-orchard",
        "src",
    ),
    ("tree_sitter_json", "tree-sitter-json", "src"),
    ("tree_sitter_julia", "tree-sitter-julia", "src"),
    ("tree_sitter_lua", "tree-sitter-lua", "src"),
    ("tree_sitter_make", "tree-sitter-make", "src"),
    ("tree_sitter_newick", "tree-sitter-newick", "src"),
    ("tree_sitter_nix", "tree-sitter-nix", "src"),
    ("tree_sitter_objc", "tree-sitter-objc", "src"),
    (
        "tree_sitter_ocaml",
        "tree-sitter-ocaml",
        "grammars/ocaml/src",
    ),
    (
        "tree_sitter_ocaml_interface",
        "tree-sitter-ocaml",
        "grammars/interface/src",
    ),
    ("tree_sitter_pascal", "tree-sitter-pascal", "src"),
    ("tree_sitter_perl", "ts-parser-perl", "src"),
    ("tree_sitter_php", "tree-sitter-php", "php/src"),
    ("tree_sitter_proto", "tree-sitter-proto", "src"),
    ("tree_sitter_qmljs", "tree-sitter-qmljs", "src"),
    ("tree_sitter_r", "tree-sitter-r", "src"),
    ("tree_sitter_racket", "tree-sitter-racket", "src"),
    ("tree_sitter_ruby", "tree-sitter-ruby", "src"),
    ("tree_sitter_scala", "tree-sitter-scala", "src"),
    ("tree_sitter_scheme", "tree-sitter-scheme", "src"),
    ("tree_sitter_solidity", "tree-sitter-solidity", "src"),
    ("tree_sitter_sql", "tree-sitter-sequel", "src"),
    ("tree_sitter_swift", "tree-sitter-swift", "src"),
    ("tree_sitter_toml", "tree-sitter-toml-ng", "src"),
    ("tree_sitter_verilog", "tree-sitter-verilog", "src"),
    ("tree_sitter_vhdl", "tree-sitter-vhdl", "src"),
    ("tree_sitter_xml", "tree-sitter-xml", "xml/src"),
    ("tree_sitter_yaml", "tree-sitter-yaml", "src"),
    ("tree_sitter_zig", "tree-sitter-zig", "src"),
];

// Grammars in vendored_parsers: (constructor symbol, folder).
const VENDORED: &[(&str, &str)] = &[
    ("tree_sitter_janet_simple", "tree-sitter-janet-simple-src"),
    ("tree_sitter_kotlin", "tree-sitter-kotlin-src"),
    ("tree_sitter_latex", "tree-sitter-latex-src"),
    ("tree_sitter_smali", "tree-sitter-smali-src"),
    // TSX patched so arrays of imported types parse.
    ("tree_sitter_tsx_diffr", "tree-sitter-tsx-src"),
];

fn main() {
    let roots = package_roots();
    let mut sources: Vec<(&str, PathBuf)> = PACKAGES
        .iter()
        .map(|&(symbol, package, folder)| (symbol, roots[package].join(folder)))
        .collect();
    sources.extend(
        VENDORED
            .iter()
            .map(|&(symbol, folder)| (symbol, Path::new("vendored_parsers").join(folder))),
    );
    for (_, source) in &sources {
        println!("cargo:rerun-if-changed={}", source.display());
    }
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    sources
        .par_iter()
        .for_each(|(symbol, source)| pack(symbol, source, &out.join(symbol)));
    let mut grammars = String::new();
    for (symbol, _) in &sources {
        let name = symbol.strip_prefix("tree_sitter_").unwrap().to_uppercase();
        writeln!(
            grammars,
            "grammar!({name}, diffr_unpack_{symbol}, diffr_{symbol});"
        )
        .unwrap();
    }
    std::fs::write(out.join("grammars.rs"), grammars).unwrap();
}

/// Map each locked package name to its source directory, including vendored registries.
fn package_roots() -> BTreeMap<String, PathBuf> {
    let metadata = Command::new(std::env::var_os("CARGO").unwrap())
        .args([
            "metadata",
            "--locked",
            "--all-features",
            "--format-version",
            "1",
        ])
        .output()
        .expect("reading Cargo dependency metadata");
    assert!(
        metadata.status.success(),
        "{}",
        String::from_utf8_lossy(&metadata.stderr)
    );
    let metadata: serde_json::Value = serde_json::from_slice(&metadata.stdout).unwrap();
    metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|package| {
            let manifest = Path::new(package["manifest_path"].as_str().unwrap());
            (
                package["name"].as_str().unwrap().to_owned(),
                manifest.parent().unwrap().to_owned(),
            )
        })
        .collect()
}

/// Write `<out>/grammar.c` with packed tables, the `diffr_unpack_<symbol>` function that
/// fills them, and the grammar's constructor renamed to `diffr_<symbol>`, then compile it.
fn pack(symbol: &str, source: &Path, out: &Path) {
    std::fs::create_dir_all(out).unwrap();
    if std::env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "wasm32" {
        let grammar = format!(
            "#define {symbol} diffr_{symbol}\n\
             #include \"parser.c\"\n\
             void diffr_unpack_{symbol}(void) {{}}\n"
        );
        std::fs::write(out.join("grammar.c"), grammar).unwrap();
        let mut build = compiler(source, out);
        build.file(out.join("grammar.c"));
        if source.join("scanner.c").is_file() {
            build.file(source.join("scanner.c"));
        }
        build.compile(symbol);
        return;
    }
    let parser = std::fs::read_to_string(source.join("parser.c")).unwrap();
    let header = std::fs::read_to_string(source.join("tree_sitter/parser.h")).unwrap();
    let tables = tables(&parser, &header);
    let bytes = table_bytes(symbol, source, out, &parser, &tables);

    let mut grammar = format!(
        "#include <stdlib.h>\n\
         size_t ZSTD_decompress(void *dst, size_t dst_capacity, const void *src, size_t src_size);\n\
         #define {symbol} diffr_{symbol}\n"
    );
    grammar.push_str(&empty_tables(&parser, &tables, &bytes));
    for (table, bytes) in tables.iter().zip(&bytes) {
        let packed = zstd::bulk::compress(bytes, 19).unwrap();
        write!(
            grammar,
            "\nstatic const unsigned char packed_{}[] = {{",
            table.name
        )
        .unwrap();
        for byte in packed {
            write!(grammar, "{byte},").unwrap();
        }
        grammar.push_str("};\n");
    }
    grammar.push_str(
        "\nstatic void unpack(void *table, size_t size, const unsigned char *packed, size_t packed_size) {\n\
         \x20 if (ZSTD_decompress(table, size, packed, packed_size) != size) abort();\n\
         }\n",
    );
    writeln!(grammar, "\nvoid diffr_unpack_{symbol}(void) {{").unwrap();
    for Table { name, .. } in &tables {
        writeln!(
            grammar,
            "  unpack({name}, sizeof {name}, packed_{name}, sizeof packed_{name});"
        )
        .unwrap();
    }
    grammar.push_str("}\n");
    std::fs::write(out.join("grammar.c"), grammar).unwrap();

    let mut build = compiler(source, out);
    build.file(out.join("grammar.c"));
    if source.join("scanner.c").is_file() {
        build.file(source.join("scanner.c"));
    }
    build.compile(symbol);
}

/// Compile the tables for the target and read each one's bytes out of the object file.
fn table_bytes(
    symbol: &str,
    source: &Path,
    out: &Path,
    parser: &str,
    tables: &[Table],
) -> Vec<Vec<u8>> {
    // Global symbols can be found by name. Mach-O and COFF symbols carry no
    // size, so each table's size is compiled in beside it.
    let mut globals = parser.to_owned();
    for storage in tables
        .iter()
        .rev()
        .filter_map(|table| table.storage.clone())
    {
        globals.replace_range(storage, "");
    }
    for Table { name, .. } in tables {
        writeln!(
            globals,
            "const unsigned long long diffr_size_{name} = sizeof {name};"
        )
        .unwrap();
    }
    let tables_c = out.join("tables.c");
    std::fs::write(&tables_c, globals).unwrap();
    let [object_path] = <[PathBuf; 1]>::try_from(
        compiler(source, out)
            .file(&tables_c)
            .opt_level(0)
            .compile_intermediates(),
    )
    .unwrap();

    let data = std::fs::read(object_path).unwrap();
    let file = object::File::parse(&*data).unwrap();
    let prefix = if file.format() == object::BinaryFormat::MachO {
        "_"
    } else {
        ""
    };
    let read = |name: &str, size: usize| -> Vec<u8> {
        let symbol = file
            .symbol_by_name(&format!("{prefix}{name}"))
            .unwrap_or_else(|| panic!("{name} is missing from the {symbol} tables object"));
        let section = file
            .section_by_index(symbol.section_index().unwrap())
            .unwrap();
        if section.kind() == object::SectionKind::UninitializedData {
            return vec![0; size];
        }
        let start = usize::try_from(symbol.address() - section.address()).unwrap();
        section.data().unwrap()[start..start + size].to_vec()
    };
    tables
        .iter()
        .map(|Table { name, .. }| {
            let size: [u8; 8] = read(&format!("diffr_size_{name}"), 8).try_into().unwrap();
            let size = if file.is_little_endian() {
                u64::from_le_bytes(size)
            } else {
                u64::from_be_bytes(size)
            };
            read(name, usize::try_from(size).unwrap())
        })
        .collect()
}

fn compiler(source: &Path, out: &Path) -> cc::Build {
    let mut build = cc::Build::new();
    build.include(source).warnings(false).out_dir(out);
    if std::env::var("CARGO_CFG_TARGET_ENV").unwrap() == "msvc" {
        build.flag("/utf-8");
    }
    build
}

/// A top-level array definition in `parser.c`, `T name[...] = {...};`, whose
/// elements are plain data.
struct Table<'a> {
    name: &'a str,
    element: &'a str,
    /// The array declarator when it states its size; `None` for `name[]`.
    sized_declarator: Option<&'a str>,
    /// The `static` keyword, if any.
    storage: Option<Range<usize>>,
    definition: Range<usize>,
}

/// Find the tables to pack: top-level arrays whose element type is plain data.
fn tables<'a>(parser: &'a str, header: &str) -> Vec<Table<'a>> {
    let mut c = tree_sitter::Parser::new();
    c.set_language(&tree_sitter_c::LANGUAGE.into()).unwrap();
    let header_tree = c.parse(header, None).unwrap();
    let mut typedefs = BTreeMap::new();
    let mut nodes = vec![header_tree.root_node()];
    while let Some(node) = nodes.pop() {
        let mut cursor = node.walk();
        if node.kind() != "type_definition" {
            nodes.extend(node.children(&mut cursor));
            continue;
        }
        let ty = node.child_by_field_name("type").unwrap();
        // A typedef declared through a pointer is left out, so a table of it fails to resolve.
        for name in node
            .children_by_field_name("declarator", &mut cursor)
            .filter(|declarator| declarator.kind() == "type_identifier")
        {
            typedefs.insert(&header[name.byte_range()], ty);
        }
    }

    let tree = c.parse(parser, None).unwrap();
    let text = |node: tree_sitter::Node| &parser[node.byte_range()];
    let mut cursor = tree.walk();
    tree.root_node()
        .children(&mut cursor)
        .filter_map(|definition| {
            let init = definition
                .child_by_field_name("declarator")
                .filter(|init| {
                    definition.kind() == "declaration" && init.kind() == "init_declarator"
                })?;
            init.child_by_field_name("value")
                .filter(|value| value.kind() == "initializer_list")?;
            // An array of pointers, such as `ts_symbol_names`, has a pointer declarator here.
            let array = init
                .child_by_field_name("declarator")
                .filter(|array| array.kind() == "array_declarator")?;
            let mut name = array;
            while name.kind() == "array_declarator" {
                name = name.child_by_field_name("declarator").unwrap();
            }
            let ty = definition.child_by_field_name("type").unwrap();
            let mut cursor = definition.walk();
            let storage = definition
                .children(&mut cursor)
                .find(|child| child.kind() == "storage_class_specifier" && text(*child) == "static")
                .map(|keyword| keyword.byte_range());
            plain_data(ty, parser, header, &typedefs).then(|| Table {
                name: text(name),
                element: text(ty),
                sized_declarator: array.child_by_field_name("size").map(|_| text(array)),
                storage,
                definition: definition.byte_range(),
            })
        })
        .collect()
}

/// Whether values of the C type `ty` are plain data: integers, `bool`, enums,
/// and structs or unions of them, with no pointers. Panics on a type it cannot
/// resolve, so an unknown type never gets packed by accident.
fn plain_data(
    ty: tree_sitter::Node,
    source: &str,
    header: &str,
    typedefs: &BTreeMap<&str, tree_sitter::Node>,
) -> bool {
    match ty.kind() {
        "primitive_type" | "sized_type_specifier" | "enum_specifier" => true,
        "type_identifier" => {
            let name = &source[ty.byte_range()];
            let ty = typedefs
                .get(name)
                .unwrap_or_else(|| panic!("cannot resolve the C type {name}"));
            plain_data(*ty, header, header, typedefs)
        }
        "struct_specifier" | "union_specifier" => {
            let body = ty.child_by_field_name("body").unwrap_or_else(|| {
                panic!("cannot resolve the C type {}", &source[ty.byte_range()])
            });
            let mut cursor = body.walk();
            let plain = body
                .named_children(&mut cursor)
                .filter(|field| field.kind() != "comment")
                .all(|field| {
                    assert_eq!(
                        field.kind(),
                        "field_declaration",
                        "unexpected struct member"
                    );
                    let mut cursor = field.walk();
                    let plain_declarators = field
                        .children_by_field_name("declarator", &mut cursor)
                        .all(|mut declarator| {
                            while declarator.kind() == "array_declarator" {
                                declarator = declarator.child_by_field_name("declarator").unwrap();
                            }
                            declarator.kind() == "field_identifier"
                        });
                    plain_declarators
                        && plain_data(
                            field.child_by_field_name("type").unwrap(),
                            source,
                            header,
                            typedefs,
                        )
                });
            plain
        }
        kind => panic!(
            "cannot resolve the C type {} ({kind})",
            &source[ty.byte_range()]
        ),
    }
}

/// Replace each table's definition with an empty, writable array of the same size.
fn empty_tables(parser: &str, tables: &[Table], bytes: &[Vec<u8>]) -> String {
    let mut emptied = parser.to_owned();
    for (table, bytes) in tables.iter().zip(bytes).rev() {
        let declarator = table.sized_declarator.map_or_else(
            || {
                format!(
                    "{}[{} / sizeof({})]",
                    table.name,
                    bytes.len(),
                    table.element
                )
            },
            str::to_owned,
        );
        emptied.replace_range(
            table.definition.clone(),
            &format!("static {} {declarator};", table.element),
        );
    }
    emptied
}
