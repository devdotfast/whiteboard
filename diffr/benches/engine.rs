//! See docs/benchmarks.md for workloads, timing boundaries and comparisons.
use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use diffr_core::config::{Config, Params};
use diffr_core::options::DiffOptions;
use diffr_core::pairing::Pairing;
use diffr_core::protocol::{project, Diff, FileChange, FileRef, FileStatus, Source};
use diffr_core::summary::{DiffResult, FileFormat};
use diffr_core::{config, pairing, protocol};
use std::hint::black_box;
use std::num::NonZeroUsize;
use std::path::Path;
use std::time::Duration;

// Match the CLI allocator on each platform.
#[cfg(not(any(windows, target_os = "illumos", target_os = "freebsd")))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[path = "support/host.rs"]
mod host;

struct Fixture {
    path: &'static str,
    before: &'static str,
    after: &'static str,
}

macro_rules! fixture {
    ($path:literal, $name:literal) => {
        Fixture {
            path: $path,
            before: include_str!(concat!("fixtures/pr998/before-", $name)),
            after: include_str!(concat!("fixtures/pr998/after-", $name)),
        }
    };
}

const FILES: &[Fixture] = &[
    fixture!(
        "packages/review/app/src/ask-composer.tsx",
        "ask-composer.tsx"
    ),
    fixture!("packages/review/app/src/ask-panel.tsx", "ask-panel.tsx"),
    fixture!("packages/review/src/ask/thread-state.ts", "thread-state.ts"),
    fixture!("packages/review/src/ask/thread.ts", "thread.ts"),
];

fn project_file(fixture: &Fixture, params: &Params) -> (FileChange, Pairing<Source>) {
    let result = DiffResult::from_sources_with_options(
        fixture.path,
        fixture.before,
        fixture.after,
        params,
        &DiffOptions {
            syntax: true,
            ..DiffOptions::default()
        },
    )
    .expect("fixture must diff successfully");
    assert!(
        matches!(result.file_format, FileFormat::SupportedLanguage(_)),
        "fixture fell back from structural diffing: {:?}",
        result.file_format
    );
    let reference = FileRef {
        path: fixture.path.into(),
        oid: String::new(),
        mode: "100644".into(),
    };
    let file = FileChange {
        file: Pairing::Both {
            lhs: reference.clone(),
            rhs: reference,
        },
        status: FileStatus::Modified,
        tags: Vec::new(),
    };
    let diff = project::diff(
        &result,
        project::Inputs {
            file: &file.file,
            sizes: (fixture.before.len() as u64, fixture.after.len() as u64),
        },
    );
    let Diff::Text { sides, .. } = diff else {
        panic!("fixture must produce a text diff")
    };
    (file, sides)
}

fn pipeline(config: &Config) -> host::Pipeline {
    host::Pipeline::from_config(
        config,
        Path::new(env!("CARGO_MANIFEST_DIR")),
        NonZeroUsize::new(1).unwrap(),
    )
    .expect("bundled shape plugins must load")
}

fn benchmarks(c: &mut Criterion) {
    let default = Config::default();
    let no_context = Config::from_toml_in(
        "[plugins.shape.bundled.context]\nenabled = false\n",
        Path::new(""),
    )
    .expect("valid benchmark configuration");
    let context_only = Config::from_toml_in(
        "[plugins.shape]\norder = [\"bundled.context\"]\n",
        Path::new(""),
    )
    .expect("valid context-only configuration");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let mut startup = c.benchmark_group("init/queries");
    for (name, config) in [("default", &default), ("no_context", &no_context)] {
        startup.bench_function(name, |b| {
            b.iter(|| black_box(config.compile().expect("queries compile")))
        });
    }
    startup.finish();

    let bytes = FILES
        .iter()
        .map(|f| f.before.len() + f.after.len())
        .sum::<usize>() as u64;
    let mut engine = c.benchmark_group("engine/pr998");
    engine.throughput(Throughput::Bytes(bytes));
    for (name, config) in [("default", &default), ("no_context", &no_context)] {
        let params = config.compile().expect("queries compile");
        let pipeline = pipeline(config);
        // Fail before measuring if a plugin errors or corrupts source text.
        for fixture in FILES {
            let (file, sides) = project_file(fixture, &params);
            let shaped = runtime
                .block_on(pipeline.run(&file, sides))
                .expect("plugins succeed");
            assert_eq!(shaped.lhs().unwrap().text, fixture.before);
            assert_eq!(shaped.rhs().unwrap().text, fixture.after);
        }
        engine.bench_function(name, |b| {
            b.iter(|| {
                for fixture in FILES {
                    let (file, sides) = project_file(black_box(fixture), &params);
                    black_box(
                        runtime
                            .block_on(pipeline.run(&file, sides))
                            .expect("plugins succeed"),
                    );
                }
            })
        });
    }
    engine.finish();

    // Keep the same default-query trees. Clone outside the timed routine because
    // plugins mutate their input; reusing shaped output would benchmark a no-op.
    let params = default.compile().expect("queries compile");
    let projected: Vec<_> = FILES.iter().map(|f| project_file(f, &params)).collect();
    let context = pipeline(&context_only);
    c.bench_function("shape/pr998/context", |b| {
        b.iter_batched(
            || projected.clone(),
            |files| {
                for (file, sides) in files {
                    black_box(
                        runtime
                            .block_on(context.run(&file, sides))
                            .expect("context succeeds"),
                    );
                }
            },
            BatchSize::PerIteration,
        )
    });
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(10).warm_up_time(Duration::from_secs(1)).measurement_time(Duration::from_secs(5));
    targets = benchmarks
}
criterion_main!(benches);
