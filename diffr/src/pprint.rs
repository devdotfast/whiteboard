//! Render saved results without the repository, configuration or plugins.
use crate::{
    pairing::Pairing,
    protocol::{Diff, Event, FileRef, Node, Outcome, Region, Source, VERSION},
};
use anyhow::{ensure, Context};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{BufRead, Write},
};

enum Item<'a> {
    Row {
        alignment: u32,
        offset: u32,
        line: u32,
        text: &'a str,
        changed: bool,
    },
    Fold {
        id: u32,
        first: u32,
        last: u32,
    },
}
impl Item<'_> {
    fn key(&self) -> (bool, u32, u32) {
        match self {
            Self::Row {
                alignment, offset, ..
            } => (false, *alignment, *offset),
            Self::Fold { id, .. } => (true, *id, 0),
        }
    }
    fn is_fold(&self) -> bool {
        matches!(self, Self::Fold { .. })
    }
}

fn visible(source: &Source) -> anyhow::Result<Vec<Item<'_>>> {
    let lines: Vec<_> = source.text.split('\n').collect();
    fn visit<'a>(
        regions: &[Region],
        lines: &[&'a str],
        items: &mut Vec<Item<'a>>,
        hidden: bool,
    ) -> anyhow::Result<()> {
        for region in regions {
            let first = region.range.start.line;
            let end = region
                .range
                .end
                .line
                .checked_add(u32::from(region.range.end.column > 0))
                .context("region line range overflow")?;
            ensure!(
                first <= end && end as usize <= lines.len(),
                "region line range out of bounds"
            );
            let collapsed = region.visibility.collapsed;
            if !hidden && collapsed && end > first {
                items.push(Item::Fold {
                    id: region.fold_state_id,
                    first,
                    last: end - 1,
                });
            }
            match &region.node {
                Node::Fold { children, .. } => visit(children, lines, items, hidden || collapsed)?,
                Node::Leaf {
                    alignment_id,
                    changed,
                    ..
                } if !hidden && !collapsed => {
                    for line in first..end {
                        let text = lines[line as usize];
                        items.push(Item::Row {
                            alignment: *alignment_id,
                            offset: line - first,
                            line,
                            text: text.strip_suffix('\r').unwrap_or(text),
                            changed: changed.iter().any(|span| span.line == line),
                        });
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
    let mut items = Vec::new();
    visit(
        std::slice::from_ref(&source.root),
        &lines,
        &mut items,
        false,
    )?;
    Ok(items)
}

/// Pair the two sides' rows by alignment and fold IDs.
fn pair<'a, 's>(
    left: &'a [Item<'s>],
    right: &'a [Item<'s>],
) -> Vec<(Option<&'a Item<'s>>, Option<&'a Item<'s>>)> {
    let mut rows = Vec::new();
    let mut positions: BTreeMap<_, Vec<_>> = BTreeMap::new();
    for (index, item) in right.iter().enumerate() {
        positions.entry(item.key()).or_default().push(index);
    }
    let mut cursor = 0;
    for l in left {
        let matching = positions
            .get(&l.key())
            .and_then(|indices| indices.get(indices.partition_point(|index| *index < cursor)));
        if let Some(&matched) = matching {
            rows.extend(right[cursor..matched].iter().map(|r| (None, Some(r))));
            rows.push((Some(l), Some(&right[matched])));
            cursor = matched + 1;
        } else {
            rows.push((Some(l), None));
        }
    }
    rows.extend(right[cursor..].iter().map(|r| (None, Some(r))));
    rows
}

fn fold_row(left: Option<&Item<'_>>, right: Option<&Item<'_>>) -> String {
    let mut ranges = Vec::new();
    let mut identity = 0;
    for (item, side) in [(left, "base"), (right, "head")] {
        if let Some(Item::Fold { id, first, last }) = item {
            identity = *id;
            ranges.push(format!("{side} {}–{}", first + 1, last + 1));
        }
    }
    format!(
        "              … {} collapsed [fold_state_id={identity}] …",
        ranges.join(" / ")
    )
}

fn path(file: &Pairing<FileRef>) -> &str {
    &file.rhs().or(file.lhs()).expect("a file has a side").path
}

fn render(file: &Pairing<FileRef>, diff: &Diff) -> anyhow::Result<String> {
    let Diff::Text { sides: sources, .. } = diff else {
        return Ok(format!("{} — Binary file", path(file)));
    };
    let lhs = sources.lhs();
    let rhs = sources.rhs();
    let name = match file {
        Pairing::Both { lhs, rhs } if lhs.path != rhs.path => {
            format!("{} → {}", lhs.path, rhs.path)
        }
        Pairing::Both { rhs: file, .. }
        | Pairing::LeftOnly { lhs: file }
        | Pairing::RightOnly { rhs: file } => file.path.clone(),
    };
    let (label, columns) = match (lhs, rhs) {
        (Some(_), Some(_)) => ("base → head", " base  head"),
        (Some(_), None) => ("base", " base"),
        (None, _) => ("head", " head"),
    };
    let mut output = vec![format!("{name} — {label}"), columns.to_owned()];
    let mut folded = false;
    if let (Some(lhs), Some(rhs)) = (lhs, rhs) {
        let (left, right) = (visible(lhs)?, visible(rhs)?);
        for (l, r) in pair(&left, &right) {
            if l.is_some_and(Item::is_fold) || r.is_some_and(Item::is_fold) {
                output.push(fold_row(l, r));
                folded = true;
                continue;
            }
            match (l, r) {
                (
                    Some(Item::Row {
                        line: ll,
                        text: lt,
                        changed: false,
                        ..
                    }),
                    Some(Item::Row {
                        line: rl,
                        text: rt,
                        changed: false,
                        ..
                    }),
                ) if lt == rt => {
                    output.push(
                        format!("{:>5} {:>5}   {rt}", ll + 1, rl + 1)
                            .trim_end()
                            .to_owned(),
                    );
                }
                _ => {
                    if let Some(Item::Row { line, text, .. }) = l {
                        output.push(
                            format!("{:>5}       - {text}", line + 1)
                                .trim_end()
                                .to_owned(),
                        );
                    }
                    if let Some(Item::Row { line, text, .. }) = r {
                        output.push(
                            format!("      {:>5} + {text}", line + 1)
                                .trim_end()
                                .to_owned(),
                        );
                    }
                }
            }
        }
    } else {
        let source = lhs.or(rhs).expect("a text diff has a side");
        for item in &visible(source)? {
            match item {
                Item::Fold { .. } => {
                    output.push(fold_row(lhs.map(|_| item), rhs.map(|_| item)));
                    folded = true;
                }
                Item::Row {
                    line,
                    text,
                    changed,
                    ..
                } => {
                    let marker = if !changed {
                        " "
                    } else if lhs.is_some() {
                        "-"
                    } else {
                        "+"
                    };
                    output.push(
                        format!("{:>5} {marker} {text}", line + 1)
                            .trim_end()
                            .to_owned(),
                    );
                }
            }
        }
    }
    if folded {
        output.push(String::new());
        output.push("[More context: set visibility.collapsed=false for the indicated fold_state_id\nin the saved JSON, then run diffr pprint again. Full text and children are present.]".to_owned());
    }
    Ok(output.join("\n"))
}

fn open(region: &mut Region, ids: &BTreeSet<u32>, unseen: &mut BTreeSet<u32>) {
    if ids.contains(&region.fold_state_id) {
        region.visibility.collapsed = false;
        unseen.remove(&region.fold_state_id);
    }
    if let Node::Fold { children, .. } = &mut region.node {
        for child in children {
            open(child, ids, unseen);
        }
    }
}

fn open_folds(diff: &mut Diff, ids: &BTreeSet<u32>, unseen: &mut BTreeSet<u32>) {
    if let Diff::Text { sides, .. } = diff {
        match sides {
            Pairing::Both { lhs, rhs } => {
                open(&mut lhs.root, ids, unseen);
                open(&mut rhs.root, ids, unseen);
            }
            Pairing::LeftOnly { lhs } => open(&mut lhs.root, ids, unseen),
            Pairing::RightOnly { rhs } => open(&mut rhs.root, ids, unseen),
        }
    }
}

pub(crate) fn run(input: impl BufRead, output: &mut impl Write, ids: &[u32]) -> anyhow::Result<()> {
    let mut started = false;
    let mut complete = false;
    let ids: BTreeSet<_> = ids.iter().copied().collect();
    let mut unseen = ids.clone();
    for (index, line) in input.lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let event: Event =
            serde_json::from_str(&line).with_context(|| format!("NDJSON line {}", index + 1))?;
        ensure!(!complete, "record after complete");
        match event {
            Event::Start { version, .. } => {
                ensure!(!started, "duplicate start record");
                ensure!(version == VERSION, "unsupported wire version {version}");
                started = true;
            }
            Event::File { file, outcome } => {
                ensure!(started, "file record before start");
                match outcome {
                    Outcome::Diff { mut diff } => {
                        open_folds(&mut diff, &ids, &mut unseen);
                        writeln!(output, "{}", render(&file, &diff)?)?;
                    }
                    Outcome::Error { error } => {
                        anyhow::bail!("{}: {}", path(&file), error.message)
                    }
                }
            }
            Event::Complete {
                failed, aborted, ..
            } => {
                ensure!(started, "complete record before start");
                if let Some(problem) = aborted {
                    anyhow::bail!("{}", problem.message);
                }
                ensure!(failed == 0, "diff stream has {failed} failed files");
                complete = true;
            }
        }
    }
    ensure!(complete, "incomplete diff stream");
    ensure!(unseen.is_empty(), "unknown fold states: {unseen:?}");
    Ok(())
}
