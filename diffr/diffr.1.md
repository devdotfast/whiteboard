% DIFFR(1)
% diffr contributors

# NAME

diffr - structural Git comparisons and local diff streaming

# SYNOPSIS

**diffr** [OPTIONS] [REVISION [REVISION]] [**--** PATHSPEC...]

**diffr** **--no-index** BEFORE AFTER

**diffr** REVISION REVISION **--format ndjson**

# DESCRIPTION

Without revisions, compare index to working tree. With --cached, compare HEAD to
index. With one revision, compare that revision to working tree. With two,
compare their trees. A...B compares merge-base(A,B) to B; A..B compares A to B.

# OPTIONS

**--repo** DIRECTORY
: Discover the repository from DIRECTORY (default current directory).

**--cached**, **--staged**
: Compare a revision (default HEAD) to the index.

**-R**
: Reverse before and after.

**--name-only**, **--name-status**, **--stat**, **--numstat**, **--shortstat**
: Print metadata without syntax matching. Stat counts are textual.

**--quiet**, **--exit-code**
: Exit 1 for changes. Quiet also suppresses output. Errors exit 2.

**--format** ndjson
: Write the event stream described under STREAMING instead of opening the
  terminal UI, which needs a terminal.

**-U** N
: Select ordinary context padding (default 3).

**--help**
: List the supported options. Unsupported Git flags are rejected.

# STREAMING

--format ndjson emits start, file, file_error and complete records to stdout.
Computation and output run on separate threads with a bounded queue.
See docs/streaming.md for the event schema and exit status contract.
