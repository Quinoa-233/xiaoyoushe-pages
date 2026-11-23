#!/usr/bin/env bash
# 构建并把静态产物强制推送到 gh-pages 分支（GitHub Pages 走"分支发布"模式用）
#
# 用法: bash scripts/push-gh-pages.sh
# Pages 设置需为: Source = Deploy from a branch, Branch = gh-pages / (root)
#
# 注意：本机会被 Steam++ (Watt Toolkit) 劫持 HTTPS，主仓库里配了
# http.sslbackend=openssl + 指定 SteamTools 的 CA 证书。临时仓库没有这份配置，
# 用默认 schannel 会报 CRYPT_E_NO_REVOCATION_CHECK，所以这里把配置带过去。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/build-gh-pages.sh

REMOTE=$(git remote get-url origin)
SSL_BACKEND=$(git config --local http.sslbackend || true)
SSL_CAINFO=$(git config --local http.sslcainfo || true)
# Windows 路径里的反斜杠在 bash 里打不开证书文件，统一换成正斜杠
SSL_CAINFO="${SSL_CAINFO//\\//}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp -R dist/. "$TMP"/
touch "$TMP/.nojekyll"   # 阻止 Jekyll 处理

cd "$TMP"
git init -q
git checkout -q -b gh-pages
git config core.autocrlf false
git add -A
git -c user.name="deploy-bot" -c user.email="deploy-bot@local" commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"

ARGS=()
[ -n "$SSL_BACKEND" ] && ARGS+=(-c "http.sslbackend=$SSL_BACKEND")
[ -n "$SSL_CAINFO" ] && ARGS+=(-c "http.sslcainfo=$SSL_CAINFO")
git "${ARGS[@]}" push -f "$REMOTE" gh-pages

echo "已推送到 gh-pages 分支"
