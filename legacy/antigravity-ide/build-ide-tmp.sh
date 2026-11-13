#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

for tool in spectool rpkg; do
    if ! command -v "$tool" &> /dev/null; then
        echo -e "${RED}Error: Required packaging utility '${tool}' is missing.${NC}" >&2
        echo -e "Please install it by running: ${BLUE}sudo dnf install -y ${tool}${NC}" >&2
        exit 1
    fi
done

# 1. 确保 OUTDIR 为绝对路径
OUTDIR="${OUTDIR:-$HOME/rpkg/}"
mkdir -p "$OUTDIR"
OUTDIR=$(cd "$OUTDIR" && pwd)

# 2. 记录代码仓路径
REPO_DIR=$(pwd)

# 3. 在 /tmp 中创建临时目录
BUILD_TMP_DIR=$(mktemp -d /tmp/antigravity2-ide-build-XXXXXX)

# 4. 自动清理设置
trap 'rm -rf "$BUILD_TMP_DIR"' EXIT

# 5. 创建软链接映射
ln -s "$REPO_DIR"/* "$BUILD_TMP_DIR/"

# 6. 切换到内存目录进行下载与构建
cd "$BUILD_TMP_DIR"

echo "Downloading sources for antigravity2-ide into /tmp (RAM)..."
spectool -gS antigravity-ide.spec

echo "Building antigravity2-ide RPM package..."
rpkg local --outdir "$OUTDIR" --spec antigravity-ide.spec

# 7. 切回原目录
cd "$REPO_DIR"

echo "Done! Built RPMs can be found in $OUTDIR"
