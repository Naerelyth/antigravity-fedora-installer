#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} == --help ]]; then
    echo 'Usage: bash scripts/test.sh [Antigravity.tar.gz]'
    echo 'Default input: $ANTIGRAVITY_ARCHIVE or $HOME/TMP/Antigravity.tar.gz'
    exit 0
fi
[[ $# -le 1 ]] || { echo 'Expected at most one archive path.' >&2; exit 2; }
archive=${1:-${ANTIGRAVITY_ARCHIVE:-$HOME/TMP/Antigravity.tar.gz}}
[[ -f "$archive" ]] || { echo "Archive not found: $archive" >&2; exit 1; }
test_dir=$(mktemp -d /tmp/antigravity-tests.XXXXXX)
trap 'rm -rf -- "$test_dir"' EXIT
tar -xOf "$archive" Antigravity-x64/resources/app.asar > "$test_dir/app.asar"
ANTIGRAVITY_TEST_ASAR="$test_dir/app.asar" node --test "$project_dir"/test/*.test.js "$project_dir"/tools/window-controls/test/*.test.js
