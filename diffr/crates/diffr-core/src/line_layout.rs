//! Full-file line alignment, and the runs of rows the projection builds
//! leaves from.
mod matched_lines;

use crate::pairing::Pairing;
use crate::parse::syntax::MatchedPos;
use matched_lines::all_matched_lines_filled;
use std::collections::BTreeSet;

pub(crate) type Row = (Option<usize>, Option<usize>);

pub(crate) fn novel_lines(positions: &[MatchedPos]) -> BTreeSet<usize> {
    positions
        .iter()
        .filter(|position| position.kind.is_novel())
        .map(|position| position.pos.line.as_usize())
        .collect()
}

pub(crate) fn aligned_rows(
    (lhs_src, rhs_src): (&str, &str),
    (lhs_positions, rhs_positions): (&[MatchedPos], &[MatchedPos]),
) -> Vec<Row> {
    if lhs_src == rhs_src {
        return lhs_src
            .split_terminator('\n')
            .enumerate()
            .map(|(line, _)| (Some(line), Some(line)))
            .collect();
    }
    let lhs_lines: Vec<_> = lhs_src.split_terminator('\n').collect();
    let rhs_lines: Vec<_> = rhs_src.split_terminator('\n').collect();
    let mut lhs_seen = BTreeSet::new();
    let mut rhs_seen = BTreeSet::new();
    let anchors = all_matched_lines_filled(lhs_positions, rhs_positions, &lhs_lines, &rhs_lines)
        .into_iter()
        .filter_map(|(lhs, rhs)| {
            let lhs = lhs
                .map(|line| line.as_usize())
                .filter(|&line| line < lhs_lines.len() && lhs_seen.insert(line));
            let rhs = rhs
                .map(|line| line.as_usize())
                .filter(|&line| line < rhs_lines.len() && rhs_seen.insert(line));
            if lhs.is_none() && rhs.is_none() {
                return None;
            }
            Some((lhs, rhs))
        })
        .collect::<Vec<_>>();
    // Token positions need not cover blank-only or one-sided files. Complete
    // source coverage without changing any correspondence supplied above.
    let mut rows = Vec::new();
    let (mut left, mut right) = (0, 0);
    for (lhs, rhs) in anchors
        .into_iter()
        .chain([(Some(lhs_lines.len()), Some(rhs_lines.len()))])
    {
        let lhs_end = lhs.unwrap_or(left);
        let rhs_end = rhs.unwrap_or(right);
        while left < lhs_end || right < rhs_end {
            let l = (left < lhs_end).then_some(left);
            let r = (right < rhs_end).then_some(right);
            rows.push((l, r));
            left += usize::from(l.is_some());
            right += usize::from(r.is_some());
        }
        let l = lhs.filter(|&line| line < lhs_lines.len());
        let r = rhs.filter(|&line| line < rhs_lines.len());
        if l.is_some() || r.is_some() {
            rows.push((l, r));
        }
        if let Some(line) = l {
            left = line + 1;
        }
        if let Some(line) = r {
            right = line + 1;
        }
    }
    rows
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunKind {
    Unchanged,
    Novel,
}

/// A maximal run of aligned rows of one kind before fold splitting. Each
/// side present holds a half-open line span.
#[derive(Clone, Debug)]
pub(crate) struct Run {
    pub(crate) kind: RunKind,
    pub(crate) sides: Pairing<(usize, usize)>,
}

impl Run {
    pub(crate) fn len(&self) -> usize {
        let (start, end) = match self.sides {
            Pairing::Both { lhs, .. } | Pairing::LeftOnly { lhs } => lhs,
            Pairing::RightOnly { rhs } => rhs,
        };
        end - start
    }
}

/// Rows in order, run-length encoded by kind and side presence.
pub(crate) fn runs(
    rows: &[Row],
    lhs_novel: &BTreeSet<usize>,
    rhs_novel: &BTreeSet<usize>,
) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for &row in rows {
        let row = match row {
            (Some(lhs), Some(rhs)) => Pairing::Both { lhs, rhs },
            (Some(lhs), None) => Pairing::LeftOnly { lhs },
            (None, Some(rhs)) => Pairing::RightOnly { rhs },
            (None, None) => unreachable!("aligned_rows only emits rows with a line on some side"),
        };
        let kind = match row {
            Pairing::Both { lhs, rhs }
                if !lhs_novel.contains(&lhs) && !rhs_novel.contains(&rhs) =>
            {
                RunKind::Unchanged
            }
            _ => RunKind::Novel,
        };
        let last = runs.last_mut().filter(|run| run.kind == kind);
        match (last.map(|run| &mut run.sides), row) {
            (
                Some(Pairing::Both {
                    lhs: (_, lhs_end),
                    rhs: (_, rhs_end),
                }),
                Pairing::Both { lhs, rhs },
            ) if *lhs_end == lhs && *rhs_end == rhs => {
                *lhs_end += 1;
                *rhs_end += 1;
            }
            (Some(Pairing::LeftOnly { lhs: (_, end) }), Pairing::LeftOnly { lhs: line })
            | (Some(Pairing::RightOnly { rhs: (_, end) }), Pairing::RightOnly { rhs: line })
                if *end == line =>
            {
                *end += 1;
            }
            _ => runs.push(Run {
                kind,
                sides: row.map(|line| (line, line + 1)),
            }),
        }
    }
    runs
}

#[cfg(test)]
mod full_file_tests {
    use super::*;
    #[test]
    fn includes_blank_and_one_sided_sources_without_tokens() {
        for (lhs, rhs) in [
            ("", "\nhello\n\n"),
            ("hello\n\n", ""),
            ("\n\n", "\n"),
            ("a\nb\n", "c\n"),
        ] {
            let rows = aligned_rows((lhs, rhs), (&[], &[]));
            assert_eq!(
                rows.iter().filter_map(|row| row.0).collect::<Vec<_>>(),
                (0..lhs.split_terminator('\n').count()).collect::<Vec<_>>()
            );
            assert_eq!(
                rows.iter().filter_map(|row| row.1).collect::<Vec<_>>(),
                (0..rhs.split_terminator('\n').count()).collect::<Vec<_>>()
            );
        }
    }
}
