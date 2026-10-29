# 每日营养管家（Nutrition Tracker）v3.4

本地单页应用 + 零依赖 Node 后端。记录每日营养、查询食品、生成计划；AI 搜索与拍照估算通过后端代理调用 Kimi，**API Key 不会出现在前端**。数据仍保存在浏览器 localStorage，可自托管、可分享给他人使用。

## 快速开始

需要 Node.js（18+，推荐 20+），**无需 `npm install`**（零第三方依赖）。

```bash
# 1) 创建配置：复制 .env.example 为 .env，填入 KIMI_API_KEY
# 2) 启动（同时提供静态页面与 /api）
npm start          # 等价于 node server.js
```

Windows 也可直接双击项目根目录的 `start-server.cmd` 启动、`stop-server.cmd` 停止（脚本会切到项目目录并调用 `node server.js`）。

然后访问 **http://127.0.0.1:8080** 。

> 也可以只双击 `index.html` 使用本地食品库、记录、计划、主题等全部离线功能；但 AI 搜索/AI 拍照需要后端，页面会提示“AI 后端未连接”。

## 安装到手机（PWA）

本项目已支持 PWA：**部署到 HTTPS 后**用手机浏览器打开，即可「添加到主屏幕」当 App 用（Android Chrome 会自动出现安装提示；iPhone 用 Safari「分享 → 添加到主屏幕」）。安装后全屏运行、有桌面图标，静态页面与商品图可离线缓存；AI 功能仍需后端在线。

- Service Worker 只在 **HTTPS 或 localhost** 生效，所以公网部署必须配 HTTPS（下文 Render / VPS+Caddy / Cloudflare Tunnel 均可）。
- 数据保存在当前浏览器 localStorage：换设备/换浏览器/清站点数据会看不到原记录，请用「个人设置 → 导出数据」备份。
- 顶部「📲 安装」按钮在支持的浏览器出现；iPhone 上点它会给出手动安装步骤。

## 部署与分享

本服务是单进程、无数据库、零依赖的 Node 程序：所有数据在**访问者的浏览器 localStorage** 里，服务端只做静态文件与 AI 代理。因此“部署”= 起一个 Node 进程 + 注入 Key；“分享”= 把地址给他人，他们用同一份服务、消耗你的 Kimi 额度。

### 一键部署（最快拿到公网网址）

> ⚠️ 不要用纯静态托管（Vercel/Netlify/对象存储的纯静态模式）：AI 走同源 Node 代理，必须有 Node 进程；推荐下面三种。

**A. Render（免费档，最简单，HTTPS 自带）**

1. 把 `nutrition-tracker/` 推到一个 GitHub 仓库（`.env` 不要提交）；
2. Render → New → Blueprint，选中仓库（会读取 `render.yaml`）；
3. 填 `KIMI_API_KEY`（`sync: false` 会提示输入），点 Deploy；
4. 得到 `https://xxx.onrender.com`，手机打开即可安装 PWA。免费档会休眠，首次访问可能等 30–60 秒。

**B. 自建 VPS / NAS（Docker，稳定）**

```bash
docker compose up -d --build     # 会读取 .env 里的 KIMI_API_KEY
```

前面用 Caddy/Nginx 反代 + HTTPS（见下文示例），并设 `TRUST_PROXY=1`。

**C. 不买服务器（Cloudflare Tunnel，临时分享）**

电脑保持开机：`cloudflared tunnel --url http://127.0.0.1:8080`，会得到一个公网 HTTPS 临时地址，手机可直接访问和安装；缺点是电脑关机即失效、地址可能变化。

### 环境变量

真实环境变量优先于 `.env` 文件，Docker/systemd/PM2 注入时不需要 `.env`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `KIMI_API_KEY` | 空 | **必填**。文本上游 API Key（OpenAI 兼容），只在服务端使用；未配置时 `/api/*` 返回 503（本地功能不受影响） |
| `KIMI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 文本上游地址，**支持 `http://` 与 `https://`**（百炼 / Kimi / 任意 OpenAI 兼容服务均可） |
| `KIMI_TEXT_MODEL` | `qwen3.7-flash` | 文本模型（食品查询）。带 reasoning，预算已覆盖思考 |
| `VISION_API_KEY` | 空 | **拍照估算必填**。视觉上游 Key（不填则回退用 KIMI_API_KEY） |
| `VISION_BASE_URL` | 同文本上游 | 视觉上游地址（默认也是百炼 compatible-mode） |
| `VISION_MODEL` | `qwen3-vl-plus` | 视觉模型。**必须用 vl 系列**——qwen3.7-flash 不支持图片输入 |
| `KIMI_RPM` | `3` | 上游账号每分钟请求数，服务端按此串行排队 + 搜索缓存 |
| `HOST` | `127.0.0.1` | 监听地址。`0.0.0.0` = 所有网卡（局域网/公网可访问，会打印风险提示） |
| `PORT` | `8080` | 监听端口 |
| `API_RATE_LIMIT` | `30` | 每个客户端 IP 每窗口内 `/api/*` 最多请求次数；`0` = 关闭 |
| `API_RATE_WINDOW_MIN` | `10` | 限流窗口（分钟） |
| `TRUST_PROXY` | `0` | `1` = 在可信反向代理（Nginx/Caddy）后用 `X-Forwarded-For` 首个 IP 作为客户端 IP；直接对外暴露时保持 `0` |

### 三种启动方式

```bash
# 仅本机（默认，最安全）
npm start

# 局域网分享：同一 WiFi 下的手机/电脑可访问
HOST=0.0.0.0 PORT=8080 npm start
# Windows PowerShell：
#   $env:HOST="0.0.0.0"; $env:PORT="8080"; npm start
# 启动日志会打印局域网地址，例如 http://192.168.1.23:8080

# 公网：建议不要把 Node 直接暴露在公网，而是用下面的反向代理 + HTTPS
HOST=127.0.0.1 PORT=8080 npm start
```

### Docker

镜像基于 `node:20-alpine`，以非 root 用户 `node` 运行，内置 `HEALTHCHECK`（访问 `/api/health`）。`.env` 已被 `.dockerignore` 排除，**Key 通过运行时注入**。

```bash
docker build -t nutrition-tracker .

# 方式一：直接注入 Key（最常用）
docker run -d --name nutrition-tracker \
  -p 8080:8080 \
  -e KIMI_API_KEY=sk-你的Key \
  nutrition-tracker

# 方式二：使用本机 .env 文件（推荐，避免 Key 留在 shell history）
docker run -d --name nutrition-tracker \
  -p 8080:8080 \
  --env-file .env \
  nutrition-tracker

# 可选：调大/关闭限流、开启 TRUST_PROXY、换模型
docker run -d --name nutrition-tracker -p 8080:8080 --env-file .env \
  -e API_RATE_LIMIT=60 -e API_RATE_WINDOW_MIN=10 -e TRUST_PROXY=1 \
  nutrition-tracker

docker logs -f nutrition-tracker      # 查看启动日志与风险提示
docker inspect --format '{{.State.Health.Status}}' nutrition-tracker
# docker stop 会发送 SIGTERM：服务端先停止接收新连接，再安全退出
```

> 容器内 `HOST=0.0.0.0`、`PORT=8080` 已由 Dockerfile 设置；端口映射请按需修改（如 `-p 9000:8080`）。

### 反向代理 + HTTPS（公网推荐）

Node 只监听 `127.0.0.1:8080`，由反向代理终结 TLS。

**Caddy**（自动申请证书，最简单）：

```caddyfile
nutrition.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080
}
```

**Nginx**：

```nginx
server {
    listen 443 ssl http2;
    server_name nutrition.example.com;

    ssl_certificate     /etc/letsencrypt/live/nutrition.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nutrition.example.com/privkey.pem;

    client_max_body_size 20m;      # 拍照估算是 base64 图片，别用默认 1m

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;   # AI 请求可能较慢，避免 504
    }
}
```

启用代理后给 Node 进程设置 `TRUST_PROXY=1`，限流才会按真实客户端 IP 计数。

### 公网分享的风险与建议

- **额度共享**：所有访客都消耗你 `.env` 里同一个 Kimi 账号；公开分享前请评估额度与费用。上游 RPM 较小时（`KIMI_RPM`，账号约 3 次/分钟）并发会排队，界面会显示“AI 搜索中/排队”。
- **务必开启限流**：`API_RATE_LIMIT` / `API_RATE_WINDOW_MIN` 是每个 IP 的兜底；公网建议先设小一点（如 10 次/10 分钟）再按需放宽。`/api/health` 不计入限流（前端探测与 Docker 健康检查会频繁调用）。
- **Key 安全**：Key 只存在服务端（`.env` 或环境变量），前端只请求同源 `/api/*`；不要提交 `.env`、不要打到镜像里、不要把 Key 写进前端或 README。泄露后立即在 Kimi 控制台轮换。
- **只分享地址，不分享 Key**：别人拿到地址即可使用你的服务；若只想自己/家人用，可把 `HOST` 保持 `127.0.0.1` 仅本机访问，或仅在内网 `0.0.0.0` 开放。
- **建议加一层访问控制**：公网长期运行可考虑在 Nginx/Caddy 上加 Basic Auth、IP 白名单，或前置 Cloudflare Access 之类；本服务自身没有账号体系。
- 服务端响应统一 `Cache-Control: no-store`，并带 `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy: no-referrer` 等安全头；`.env`、`server.js`、`package.json` 等工程文件不会被静态服务返回。

### 数据与多设备

- 记录、身体数据、计划、主题全部存在**访问者浏览器 localStorage**，服务端不存任何用户数据、也没有账号系统。
- 因此：换个浏览器/设备/清空站点数据就看不到原记录；同一地址在不同设备上各自独立。需要迁移时用「个人设置 → 导出/导入」。
- 分享给别人时，对方看到的是空白数据和同一个 AI 服务（除非他们自带 Key 自建部署）。

### 移动端

页面已做响应式适配，可直接用手机浏览器访问局域网/公网地址；拍照估算会调用系统相机或相册选择图片（`<input type="file">`，无需额外权限）。建议「添加到主屏幕」当轻应用使用；注意 iOS/Android 浏览器各自独立的 localStorage 不会互相同步。

## AI 服务

- Key 只放在服务器 `.env` / 环境变量的 `KIMI_API_KEY`，前端只请求同源 `/api/*`，源码与网络请求中都不含 Key。
- 端点：
  - `GET /api/health`：返回 `host`、`port`、`textModel`、`visionModel`、`models`（实际生效的文本/视觉模型）、`maxTokens`（输出预算）、`rpm`、`rateLimit`（limit/windowMin/trustProxy）、`hasApiKey`、`queue`、`uptimeSec`，便于部署排查。
  - `POST /api/food-search`：`{query}` → AI 返回最多 4 条食品（每 100g 营养、类别、每份重量、置信说明）。
  - `POST /api/estimate-photo`：`{image, reference, description, cookMethod, hints}` → 识别食物并返回重量/热量区间、宏量营养素、不确定性说明。
- 模型：文本 `qwen3.7-flash`（阿里云百炼），视觉 `qwen3-vl-plus`。**文本模型带 reasoning**，会占用 `max_tokens`，因此输出预算必须覆盖思考：食品查询首次给 4000 tokens，若 `finish_reason=length` 导致 JSON 被截断，会自动用 5000 tokens 重试一次，仍失败才返回「AI 输出被截断」。视觉 `qwen3-vl-plus` 实测稳定，1600 tokens 足够。
- 账号限制约 **3 次/分钟**：后端做串行队列（约 20 秒一次）与 30 分钟搜索缓存；界面会显示“AI 搜索中/排队”，失败会给出明确提示。
- 上游 `KIMI_BASE_URL` 支持 `http://`/`https://`（便于接自建代理或本地 mock）；上游返回 401/403 时前端会看到“服务端 AI Key 无效或权限不足（请检查 KIMI_API_KEY）”，模型名不可用时提示检查模型配置。
- 服务器拒绝访问 `.env`、`server.js`、`package.json`、`.cjs` 等文件；所有响应 `Cache-Control: no-store`，改完刷新即可看到变化。

## 功能

- **今日总览**：卡路里、蛋白质、碳水、脂肪进度环，按餐次拆分；「待补充」不计入统计。
- **摄入记录**：搜索食品后输入克数/ml，自动换算；份/包装仅在已知重量时可用（如「1 袋（70g）」自动换算）；支持自定义食品、暂存待补充（之后可在记录里内联补全营养并计入统计）；本地搜索无结果时可用「AI 搜索营养」。
- **品牌产品**：输入品牌名（如「哥本」「卫龙」「简爱」「元气森林」）时，搜索结果上方会列出该品牌的全部产品卡片（名称、净含量、每 100g 营养、真实商品图），点击即可选中；商品图缓存在 `assets/products/`（来自公开电商商品缩略图，仅用于个人学习/演示，版权归原权利人），缺图时回退品牌色 + emoji 的本地 SVG 缩略图，也支持 `food.image` 替换。
- **食品查询**：约 230 条食品（155 条内置参考数据 + 76 条品牌产品目录，覆盖 30+ 热门/健康低卡品牌）；支持名称/品牌/别名/关键词/条形码模糊搜索；品牌食品均带包装净含量（如 70g/袋、250ml/盒、500ml/瓶）并在详情中显示；可粘贴包装文本解析并核对保存；也可用 AI 搜索补充。
- **身体数据**：BMI、BMR、TDEE、标准体重、体脂率（美国海军公式，需腰围 + 颈围，女性另需臀围；数据不全时提示补录而不是给假数值）、BAI。
- **目标计划**：减脂/增肌/保持；目标体重与周期；多选画像（身份、运动、饮食、年龄阶段）自由组合；生成月→周时间线与每餐分配；内置安全速率校验（减脂 ≤1kg/周、增肌 ≤0.5kg/周），热量、每周变化与时间线始终保持一致，目标方向不合理时自动按保持体重处理并提示。
- **AI 拍照估营养**：上传/拖拽/粘贴图片；选物品或人体参照（银行卡、A4 纸、硬币、易拉罐、手机、烟盒，以及拳头/手掌/拇指）；AI 识别多种食物并给出重量与热量**区间**、宏量营养素、误差因素；结果可改名称与克数，确认后才入账。保留「本地几何估算」作为离线兜底。
- **AI 连接自愈**：每次 AI 调用前自动检查后端（未连接时先自动重连）；后端未启动/被回收时给出中文提示（提示运行 `start-server.cmd` 或 `node server.js`）；窗口重新聚焦或从后台切回时自动重连；账号并发/频率受限（429）时显示服务端提示与建议重试时间。
- **深浅色主题**：右上角一键切换，记忆在 localStorage，首次跟随系统 `prefers-color-scheme`。
- **个人设置**：默认画像/餐数，数据导出导入、清空；显示 AI 服务状态。

## 数据模型

食品统一为每 100g/100ml：

```js
{
  id, name, brand, category, aliases[], keywords[], barcode,
  unit: "g" | "ml",
  nutrition: { calories, protein, carbs, fat, fiber, sodium },
  serving: { label, grams } | null,
  package: { label, grams } | null,
  spec, source, reliability, tags[], gl
}
```

`reliability`：`reference`（参考值）、`label`（包装标签）、`user`（用户自定义）、`pending`（待确认）、`ai`（AI 估算）。

旧版（v1）数据加载时自动迁移，无需手动处理。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 页面入口（含主题初始化与版本号） |
| `styles.css` | 样式与深色主题变量 |
| `app.js` | 前端逻辑：食品库、搜索、解析、计划、AI 调用、UI |
| `catalog.js` | 品牌产品目录（76 款）与现有包装食品图片映射（自动生成） |
| `assets/products/` | 品牌商品图片（480×480 JPEG，来自公开电商缩略图，仅演示用） |
| `assets/icons/` | PWA 图标（192/512/maskable/apple-touch） |
| `manifest.webmanifest` / `sw.js` | PWA 安装清单与 Service Worker（离线缓存） |
| `render.yaml` / `docker-compose.yml` | 一键部署（Render 免费档 / 自建 Docker） |
| `server.js` | 静态服务 + Kimi 代理 + 限流 + 优雅关闭（Key 只在服务端） |
| `package.json` | 工程元信息与 `npm start` / `npm test` 脚本（零依赖） |
| `start-server.cmd` / `stop-server.cmd` | Windows 一键启动 / 停止后端（双击运行） |
| `Dockerfile` / `.dockerignore` | 自托管镜像（node:20-alpine、非 root、HEALTHCHECK） |
| `.env` | 本机密钥（**不要分享/提交/打进镜像**） |
| `.env.example` | 配置模板（含 HOST / 限流 / TRUST_PROXY 说明） |
| `test-harness.cjs` | 核心逻辑测试（`npm test`） |

## 测试

```bash
npm test           # 等价于 node test-harness.cjs
```

当前 **129 项断言全部通过**（`npm test`）。覆盖：身体指标回归、细分/品牌搜索、单位换算、待补充统计与补全闭环、包装文本解析、多画像合成与持久化、AI 区间估算、v1→v2 迁移、条形码/别名，以及本地日期（UTC+8 凌晨边界）、体脂率围度校验、计划安全速率/反向目标/保持模式/热量-时间线一致性、品牌产品目录与真实商品图、包装净含量换算、烟盒参照物、AI 网络/429 错误中文提示、PWA manifest/Service Worker/图标完整性。

## 限制

- 账号 RPM 约 3：并发高时会排队；搜索有缓存，识图无缓存。分享给多人时是**共享同一个账号额度**。
- **Kimi 账号并发限制约 1**：同一账号同时只处理约 1 个请求，超出时会返回 **429**（前端会显示服务端提示和建议重试秒数，请稍后再试）；后端进程空闲被系统/终端回收后，浏览器会报「无法连接 AI 后端」，重新运行 `start-server.cmd`/`node server.js` 后切回页面会自动重连。
- 文本模型 `qwen3.7-flash` 带 reasoning，会占用 `max_tokens` 并增加耗时；极端情况下输出被截断会先自动提高预算重试一次。视觉估算必须使用 vl 系列模型（如 `qwen3-vl-plus`），纯文本模型不支持图片输入。
- 视觉识别受拍摄角度、遮挡、参照物与厚度影响，输出一定是区间，不应视为精确测量；AI 只会把参照物名称作为提示，无法真正按像素标定尺寸。
- 体脂率为公式估算值（美国海军公式），个体差异大；围度测量误差会明显影响结果。
- AI 营养数据为估算/参考，品牌商品请以包装标签为准。
- 无用户系统与多设备同步；数据在单浏览器 localStorage，清空浏览器数据会丢失，请用导出/导入备份。
- 本工具不构成医疗或营养学建议。
