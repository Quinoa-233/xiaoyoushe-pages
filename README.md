# xiaoyoushe-pages

校园游戏平台「第九艺术」（社团名）原型。静态站点，发布目录 public/（Cloudflare Pages destination_dir）。

## 后端（学号登录 / 小红花 / 点击数 / 游玩时长）

后端用 Cloudflare Pages Functions + D1，代码在 `functions/api/[[route]].js`。
表结构会在第一次请求时自动创建，**不用手动跑 SQL**。

需要一次性配置（约 5 分钟）：

1. Cloudflare 控制台 → **Workers & Pages → D1** → Create database，名字随意（例如 `xiaoyoushe`）。
2. 回到 **Pages 项目 → Settings → Functions → D1 database bindings** → Add binding：
   Variable name 填 `DB`，Database 选刚建的那个 → Save。
3. 重新部署一次（Deployments 里 Retry，或随便提交一次）。
4. 打开站点 → 右下角头像 → 个人中心 → 学号登录 → 首次注册。

接口一览（都是 `/api/*`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | `{sid, password, nickname?, cls?}` 首次注册 |
| POST | `/api/login` | `{sid, password}` |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前用户 + 今日已送花数 |
| GET | `/api/summary` | 每款游戏的点击 / 时长 / 小红花 |
| POST | `/api/click` | `{gameId}` 记一次点击 |
| POST | `/api/play` | `{gameId, seconds}` 累计时长 |
| POST | `/api/flower` | `{gameId, on}` 送花 / 收回，每天 10 朵 |

没绑定 D1 时接口会返回 `D1_NOT_BOUND`，前端会自动退回本机记录并提示「云端还没接上」，不会白屏。

本地调试可以 `npx wrangler pages dev public`（需要本地 `wrangler.toml` 配一个 D1 绑定，该文件不进仓库）。
