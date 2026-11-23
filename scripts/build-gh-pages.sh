#!/usr/bin/env bash
# 生成 GitHub Pages 镜像产物（dist/）
#
# 为什么要这一步：GitHub Pages 的项目站点跑在 https://<用户>.github.io/<仓库名>/ 这个子路径下，
# 而主站 index.html 里的图片/视频路径是 "/covers/..."、"/games/..." 这种根绝对路径，
# 放到子路径下会去请求 https://<用户>.github.io/covers/... 从而 404。
# 这里把主站的根绝对路径改成相对路径；游戏页本身（public/games/*）全部使用相对路径，无需处理。
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=public
OUT=dist

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SRC"/. "$OUT"/

# 只改 index.html，且只针对已知的几个目录，避免误伤 '/api/' 这类字符串
sed -i \
  -e 's|="/covers/|="covers/|g' \
  -e 's|="/games/|="games/|g' \
  -e 's|="/img/|="img/|g' \
  -e 's|"/favicon.png"|"favicon.png"|g' \
  -e "s|'/covers/|'covers/|g" \
  -e "s|'/games/|'games/|g" \
  -e "s|'/img/|'img/|g" \
  -e 's|, /covers/|, covers/|g' \
  -e 's|, /games/|, games/|g' \
  -e 's|, /img/|, img/|g' \
  "$OUT/index.html"

# _headers 是 Cloudflare Pages 专有文件，GitHub Pages 不认
rm -f "$OUT/_headers"

echo "构建完成：$OUT"
grep -c 'covers/' "$OUT/index.html" >/dev/null && echo "路径改写已执行"
echo "残留根绝对路径检查（应为 0，含 srcset 里的第二项）:"
# 注意：脚本开了 pipefail，grep 无匹配时会返回 1，会让「检查通过」变成整体失败，
# 所以这里必须兜住退出码，否则上一层的 push 脚本会在 set -e 下静默中断。
RESIDUAL=$( { grep -o '="/\(covers\|games\|img\)/\|'"'"'/\(covers\|games\|img\)/\|, /\(covers\|games\|img\)/' "$OUT/index.html" | wc -l; } || true )
echo "$RESIDUAL"
