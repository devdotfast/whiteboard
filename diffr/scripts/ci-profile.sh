#!/usr/bin/env bash
set -euo pipefail

output="diagnostics/${PROFILE_PHASE:-tests}"
mkdir -p "$output"
{
  uname -a
  lscpu
  free -h
  rustc --version --verbose
  cargo --version
} > "$output/runner.txt"

command=(/usr/bin/time -v -o "$output/resources.txt" "$@")
if [[ ${PROFILE_CPU:-false} == true ]]; then
  PERF=${PERF:-perf}
  "$PERF" stat -e cpu-clock:u -- true
  command=("$PERF" record -F 49 -e cpu-clock:u --call-graph dwarf,4096
    -o "$output/cpu.perf.data" -- "${command[@]}")
fi

started=$(date +%s)
set +e
"${command[@]}" 2>&1 | tee "$output/command.log"
status=${PIPESTATUS[0]}
set -e
elapsed=$(( $(date +%s) - started ))
printf 'wall_seconds=%s\nexit_code=%s\n' "$elapsed" "$status" > "$output/result.txt"

if [[ ${PROFILE_CPU:-false} == true ]]; then
  # Bound diagnostic postprocessing only; never time-limit the test command.
  timeout 60s "$PERF" report -i "$output/cpu.perf.data" --stdio --no-children \
    --sort dso,symbol --percent-limit 0.5 --call-graph none \
    > "$output/cpu-self.txt" || echo 'perf self-time report failed or timed out' >&2
  timeout 60s "$PERF" report -i "$output/cpu.perf.data" --stdio --children \
    --sort dso,symbol --percent-limit 1 --call-graph graph,1 \
    > "$output/cpu-stacks.txt" || echo 'perf stack report failed or timed out' >&2
fi

exit "$status"
