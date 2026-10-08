//! Compare cold eager and lazy initialization in separate processes:
//! cargo run --release -p diffr-core --example initialization -- eager
//! cargo run --release -p diffr-core --example initialization -- lazy
use diffr_core::config::Config;
use diffr_core::options::DiffOptions;
use diffr_core::summary::DiffResult;
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "lazy".into());
    anyhow::ensure!(
        matches!(mode.as_str(), "eager" | "lazy"),
        "use eager or lazy"
    );
    let start = Instant::now();
    let config = Config::default();
    let params = match mode.as_str() {
        "eager" => config.compile()?,
        _ => config.prepare()?,
    };
    let initialization = start.elapsed();
    let options = DiffOptions {
        syntax: true,
        ..Default::default()
    };
    let diff = || {
        DiffResult::from_sources_with_options(
            "example.tsx",
            "export function Counter() { return <button>1</button>; }\n",
            "export function Counter() { return <button>2</button>; }\n",
            &params,
            &options,
        )
    };
    let first = Instant::now();
    std::hint::black_box(diff()?);
    let first_diff = first.elapsed();
    let warm = Instant::now();
    for _ in 0..10 {
        std::hint::black_box(diff()?);
    }
    println!("{mode}: init={initialization:?}, first_diff={first_diff:?}, init_and_first={:?}, warm_diff={:?}",
        initialization + first_diff, warm.elapsed() / 10);
    Ok(())
}
