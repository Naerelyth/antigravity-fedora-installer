#!/usr/bin/env bash

set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$project_dir"

archive="$HOME/TMP/Antigravity.tar.gz"
asar_dir=$(mktemp -d "$HOME/TMP/antigravity-asar.XXXXXX")
work_dir=$(mktemp -d /tmp/antigravity-asar-work.XXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT

# 1. 提取原始 ASAR，不修改 tar 包
tar -xOf "$archive" Antigravity-x64/resources/app.asar \
  > "$work_dir/original.asar"

# 2. 窗口按钮修复及图标替换
node tools/window-controls/refactor-asar.js \
  "$work_dir/original.asar" \
  "$work_dir/window-controls.asar" \
  --icon assets/icon.png \
  > "$asar_dir/refactor.json"

# 3. 应用独立外观补丁，生成最终 ASAR
node tools/asar-patches/apply.js \
  "$work_dir/window-controls.asar" \
  "$work_dir/app.asar" \
  > "$asar_dir/appearance-patches.json"

# 4. 运行与 RPM 构建相同的测试
ANTIGRAVITY_TEST_ASAR="$work_dir/original.asar" \
  node --test test/*.test.js tools/window-controls/test/*.test.js

cp -- "$work_dir/app.asar" "$asar_dir/app.asar"

printf '\n最终 ASAR：%s/app.asar\n' "$asar_dir"
sha256sum "$asar_dir/app.asar"
