#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} == --help ]]; then
    echo 'Usage: bash build.sh [Antigravity.tar.gz]'
    echo 'Input: $ANTIGRAVITY_ARCHIVE or $HOME/TMP/Antigravity.tar.gz'
    echo 'Output: a new build directory under $OUTDIR or project/dist'
    echo 'Builds a patched RPM; does not install it.'
    exit 0
fi
archive=${ANTIGRAVITY_ARCHIVE:-$HOME/TMP/Antigravity.tar.gz}
archive_given=false
for arg in "$@"; do
    case "$arg" in
        --*) echo "Unknown option: $arg" >&2; exit 2 ;;
        *)
            [[ $archive_given == false ]] || { echo 'Expected one archive path.' >&2; exit 2; }
            archive=$arg
            archive_given=true
            ;;
    esac
done
for tool in node tar rpmbuild sha256sum; do
    command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
[[ -f "$archive" ]] || { echo "Archive not found: $archive" >&2; exit 1; }
archive=$(realpath -- "$archive")
output_root=${OUTDIR:-$project_dir/dist}
mkdir -p -- "$output_root"
output_root=$(cd -- "$output_root" && pwd)
build_dir=$(mktemp -d /tmp/antigravity-rpm.XXXXXX)
trap 'rm -rf -- "$build_dir"' EXIT
mkdir -p "$build_dir"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
tar -xOf "$archive" Antigravity-x64/resources/app.asar > "$build_dir/original.asar"
if ! node "$project_dir/tools/window-controls/refactor-asar.js" \
    "$build_dir/original.asar" "$build_dir/window-controls.asar" \
    --icon "$project_dir/assets/icon.png" > "$build_dir/refactor.json"; then
    echo 'ASAR preparation failed. Code drift requires reviewing and adapting the window fix before packaging. No RPM was built.' >&2
    exit 1
fi
node "$project_dir/tools/asar-patches/apply.js" "$build_dir/window-controls.asar" \
    "$build_dir/SOURCES/app.asar" > "$build_dir/appearance-patches.json"
ANTIGRAVITY_TEST_ASAR="$build_dir/original.asar" node --test "$project_dir"/test/*.test.js "$project_dir"/tools/window-controls/test/*.test.js
app_version=$(node "$project_dir/scripts/rpm-version.js" "$build_dir/refactor.json")
echo "Building Antigravity $app_version"
ln -s -- "$archive" "$build_dir/SOURCES/Antigravity.tar.gz"
cp "$project_dir/packaging/antigravity.desktop" "$project_dir/assets/antigravity.png" "$build_dir/SOURCES/"
cp "$project_dir/packaging/antigravity.spec" "$build_dir/SPECS/"
output_dir=$(mktemp -d "$output_root/antigravity-$app_version.XXXXXX")
cp "$build_dir/refactor.json" "$output_dir/refactor.json"
cp "$build_dir/appearance-patches.json" "$output_dir/appearance-patches.json"
cp "$build_dir/SOURCES/app.asar" "$output_dir/app.asar"
sha256sum "$archive" "$output_dir/app.asar" > "$output_dir/inputs.sha256"
rpmbuild -bb --define "app_version $app_version" --define "_topdir $build_dir" --define "_rpmdir $output_dir" \
    "$build_dir/SPECS/antigravity.spec" 2>&1 | tee "$output_dir/build.log"
echo "Built RPMs: $output_dir"
