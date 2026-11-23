#!/usr/bin/env bash
# 构建并把静态产物强制推送到 gh-pages 分支（GitHub Pages 走"分支发布"模式用）
#
# 用法: bash scripts/push-gh-pages.sh
# 之后 Git 会自动部署到 https://<用户>.github.io/<仓库名>/
# 需要 Pages 设置里 Source = Deploy from a branch, Branch = gh-pages / (root)
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build-gh-pages.sh

REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp -R dist/. "$TMP"/
# 阻止 Jekyll 处理，避免下划线开头的文件被吞
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="deploy-bot" -c user.email="deploy-bot@local" commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git push -f "$REMOTE" gh-pages

echo "已推送到 gh-pages 分支"
