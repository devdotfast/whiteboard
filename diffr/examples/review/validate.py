#!/usr/bin/env python3
"""Check the real-PR annotation corpus without running a diff implementation."""

import hashlib
import json
from pathlib import Path
import re
import subprocess


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected),
            f'Expected fields {expected}, got {value!r}')


def span_bytes(source, span):
    keys(span, ('start', 'end'))
    lines = source.split(b'\n')
    offsets = []
    for position in (span['start'], span['end']):
        keys(position, ('line', 'byte_column'))
        row, column = position['line'], position['byte_column']
        require(type(row) is int and type(column) is int, 'Coordinates must be integers')
        require(0 <= row < len(lines), 'Line outside source')
        line = lines[row].removesuffix(b'\r')
        require(0 <= column <= len(line), 'Byte column outside line')
        line[:column].decode('utf-8')  # Reject an endpoint inside a code point.
        offsets.append(sum(len(line) + 1 for line in lines[:row]) + column)
    start, end = offsets
    require(start < end, 'Annotation ranges must be nonempty and ordered')
    return source[start:end], start, end


def sides(correspondence):
    require(isinstance(correspondence, dict) and len(correspondence) == 1,
            'Correspondence requires exactly one variant')
    kind, value = next(iter(correspondence.items()))
    if kind == 'Paired':
        keys(value, ('lhs', 'rhs'))
        return value.items()
    require(kind in ('Added', 'Deleted'), f'Unknown correspondence: {kind}')
    return [('rhs' if kind == 'Added' else 'lhs', value)]


def patch_for(directory, provenance):
    result = subprocess.run([
        'git', '-c', 'core.quotePath=false', 'diff', '--no-index',
        '--no-ext-diff', '--no-textconv', '--no-color', '--diff-algorithm=myers',
        '--unified=3', '--', provenance['sources']['lhs']['file'], provenance['sources']['rhs']['file'],
    ], cwd=directory, capture_output=True, text=True)
    require(result.returncode == 1, f'Expected changed source pair: {result.stderr}')
    return result.stdout


def patch_rows(patch):
    visible = {'lhs': set(), 'rhs': set()}
    changed = {'lhs': set(), 'rhs': set()}
    old = new = None
    for line in patch.splitlines():
        header = re.match(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@', line)
        if header:
            old, new = (int(n) - 1 for n in header.groups())
            continue
        if old is None or line.startswith('\\'):
            continue
        if line.startswith((' ', '-')):
            visible['lhs'].add(old)
            if line.startswith('-'):
                changed['lhs'].add(old)
            old += 1
        if line.startswith((' ', '+')):
            visible['rhs'].add(new)
            if line.startswith('+'):
                changed['rhs'].add(new)
            new += 1
    return visible, changed


def covered_rows(span):
    end = span['end']
    return set(range(span['start']['line'], end['line'] + (end['byte_column'] > 0)))


def validate_case(directory):
    metadata = json.loads((directory / 'case.json').read_text())
    provenance = json.loads((directory / 'provenance.json').read_text())
    expected = json.loads((directory / 'expected.json').read_text())
    sources = {side: (directory / entry['file']).read_bytes()
               for side, entry in provenance['sources'].items()}
    keys(sources, ('lhs', 'rhs'))
    require(sources['lhs'] != sources['rhs'], 'Identical before/after files')
    for side, source in sources.items():
        source.decode('utf-8')
        saved = provenance['sources'][side]
        require(hashlib.sha256(source).hexdigest() == saved['sha256'], 'Source SHA256 mismatch')
        blob = hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest()
        if saved['path'] is None:
            require(source == b'' and saved['git_blob_sha'] is None, 'Absent side must have empty source and no blob')
        else:
            require(blob == saved['git_blob_sha'], 'Source Git blob mismatch')

    keys(expected, ('folds', 'context'))
    for name in ('folds', 'context'):
        require(isinstance(expected[name], list), f'{name} must be an array')
    patch = patch_for(directory, provenance)
    require((directory / 'change.patch').read_text() == patch, 'Saved patch differs from pinned sources')
    visible, changed = patch_rows(patch)
    excerpts = {}
    for name in ('folds', 'context'):
        for index, annotation in enumerate(expected[name]):
            if name == 'folds':
                keys(annotation, ('regions', 'placeholder'))
                require(isinstance(annotation['placeholder'], str), 'Placeholder must be a string')
                correspondence = annotation['regions']
            else:
                correspondence = annotation
            kind = next(iter(correspondence))
            for side, span in sides(correspondence):
                text, start, end = span_bytes(sources[side], span)
                excerpts[f'{name}/{index}/{side}'] = text.decode('utf-8')
                rows = covered_rows(span)
                if name == 'context':
                    require(not rows & visible[side], 'Redundant extra context already visible in U3 patch')
                elif kind in ('Added', 'Deleted'):
                    # These particular gold examples promise wholly added/deleted code.
                    # This is a corpus assertion, not a universal domain restriction.
                    require(rows <= changed[side], 'One-sided gold fold includes unchanged lines')
    require(excerpts == metadata['expected_text'], 'Ranges do not select the reviewed excerpts')
    for side, entries in metadata['keep_visible'].items():
        source = sources[side]
        for entry in entries:
            keys(entry, ('range', 'text'))
            needle, start, end = span_bytes(source, entry['range'])
            require(needle.decode('utf-8') == entry['text'], 'Visible range selects the wrong text')
            available = set(visible[side])
            for context in expected['context']:
                for context_side, span in sides(context):
                    if context_side == side:
                        available.update(covered_rows(span))
            require(covered_rows(entry['range']) <= available,
                    'Required visible snippet is missing from diff and extra context')
            for fold in expected['folds']:
                for fold_side, span in sides(fold['regions']):
                    if fold_side == side:
                        _, a, b = span_bytes(source, span)
                        require(b <= start or a >= end, 'Fold hides required signature, result, or closing delimiter')
    return len(excerpts)


def main():
    root = Path(__file__).parent / 'real'
    cases = sorted(root.glob('*/case.json'))
    require(cases, 'No real PR fixtures found')
    identities = set()
    count = 0
    for case in cases:
        provenance = json.loads((case.parent / 'provenance.json').read_text())
        identity = (provenance['repo'], provenance['pr_number'])
        require(identity not in identities, 'PR sampled more than once')
        identities.add(identity)
        try:
            count += validate_case(case.parent)
        except Exception as error:
            raise ValueError(f'{case.parent.name}: {error}') from error
        print(f'PASS {case.parent.name}')
    print(f'Validated {len(cases)} PRs and {count} annotated side ranges.')


if __name__ == '__main__':
    main()
