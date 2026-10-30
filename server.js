/**
 * 每日营养管家 - 自托管后端（v3.6.0）
 * - 静态文件服务（带 no-store，避免改完看不到变化）
 * - AI 同源代理：/api/food-search、/api/estimate-photo、/api/scan-label（营养成分表识别）
 * - 邮箱验证码注册/登录（SMTP 465 隐式 TLS，仅内置模块）+ AI 门禁：未登录 401，登录后每个会话每天 5 次额度
 * - API Key 只从环境变量 / .env 读取，绝不下发到前端
 * - 账号 RPM 限制（默认 3 次/分钟）由串行队列与缓存兜底；另有按客户端 IP 的 /api/* 限流
 * - 零第三方依赖，仅使用 Node.js 内置模块（node:sqlite 需 Node >= 22.5，推荐 24；要求 Node >= 22.5）
 *
 * 环境变量（真实进程环境变量优先于 .env 文件）：
 *   KIMI_API_KEY        必填，Kimi API Key
 *   KIMI_BASE_URL       上游地址，支持 http:// 与 https://
 *   KIMI_TEXT_MODEL     文本模型名
 *   VISION_API_KEY      视觉模型 Key（默认阿里云百炼 DashScope）
 *   VISION_BASE_URL     视觉上游地址（OpenAI 兼容，默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
 *   VISION_MODEL        视觉模型名（默认 qwen3-vl-flash）
 *   KIMI_RPM            上游账号每分钟请求数（串行队列用）
 *   AI_MAX_RETRIES      429（账号并发/频率限制）最多尝试次数（含首次，1~10，默认 6）
 *   HOST                监听地址，默认 127.0.0.1（仅本机）；0.0.0.0 表示所有网卡
 *   PORT                监听端口，默认 8080
 *   API_RATE_LIMIT      每个客户端 IP 在窗口内的 /api/* 请求上限，默认 30；0 表示关闭（auth 端点不计入此限流）
 *   API_RATE_WINDOW_MIN 限流窗口（分钟），默认 10
 *   TRUST_PROXY         1/true 时从 X-Forwarded-For 取真实客户端 IP（仅在可信反向代理后使用）
 *   DATA_DIR            SQLite 数据库文件路径（默认 ./.data/app.db；Docker 内为 /data/app.db）
 *   SMTP_HOST           邮件服务器地址（如 smtp.qq.com），未配置时无法发送验证码
 *   SMTP_PORT           邮件服务器端口（默认 465，隐式 TLS）
 *   SMTP_USER           发信账号（QQ 邮箱须与 MAIL FROM 一致）
 *   SMTP_PASS           发信授权码（不是登录密码！切勿提交/打印）
 *   MAIL_FROM_NAME      发件人显示名（默认「每日营养管家」）
 *   AUTH_DEV_LOG_CODE   仅本地调试：1 时把验证码打到服务端日志（生产务必关闭）
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const tls = require("tls");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const ROOT_REAL = (() => {
  try { return fs.realpathSync(ROOT); } catch { return ROOT; }
})();
// 与 package.json 的 version 保持一致
const VERSION = "3.6.0";

/* ---------- 配置加载 ---------- */
function loadEnvFile() {
  const env = {};
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return env;
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (err) {
    // .env 权限异常不应导致服务无法启动
    console.warn("[nutrition] 读取 .env 失败，已忽略：" + err.message);
  }
  return env;
}

const FILE_ENV = loadEnvFile();

/** 进程环境变量优先（含显式空字符串），其次 .env，最后默认值 */
function envValue(key, fallback) {
  if (Object.prototype.hasOwnProperty.call(process.env, key)) return process.env[key];
  if (Object.prototype.hasOwnProperty.call(FILE_ENV, key)) return FILE_ENV[key];
  return fallback;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

const API_KEY = String(envValue("KIMI_API_KEY", "") || "").trim();
const TEXT_MODEL = String(envValue("KIMI_TEXT_MODEL", "kimi-k2.7-code") || "").trim() || "kimi-k2.7-code";
// 视觉模型独立配置：默认阿里云百炼 qwen3-vl-plus（OpenAI 兼容端点），与文本上游解耦。
// 注意：qwen3.7-flash 不支持图片输入，拍照估算必须用 vl 系列模型。
const VISION_API_KEY = String(envValue("VISION_API_KEY", "") || "").trim();
const VISION_MODEL = String(envValue("VISION_MODEL", "qwen3-vl-plus") || "").trim() || "qwen3-vl-plus";
const RPM = Math.max(1, toInt(envValue("KIMI_RPM", 3), 3));
const MIN_INTERVAL = Math.ceil(60000 / RPM);
const CALL_TIMEOUT = 120000;
const MAX_UPSTREAM_BODY = 4 * 1024 * 1024;

// 429（账号并发/频率限制）重试策略：最多 6 次尝试（含首次），指数退避上限 8s，总等待上限 40s
// 上游 Retry-After 优先（可能超过 8s），指数退避仅在其缺失时生效
const AI_MAX_RETRIES = Math.min(10, Math.max(1, toInt(envValue("AI_MAX_RETRIES", 6), 6)));
const AI_BACKOFF_BASE_MS = 1000;
const AI_BACKOFF_FACTOR = 1.5;
const AI_MAX_BACKOFF_MS = 8000;
const AI_MAX_TOTAL_WAIT_MS = 40000;

// 文本模型带 reasoning，思考会占用 max_tokens（qwen3.7-flash 实测约 300，kimi-k2.7-code 566+）：
// 预算需覆盖"思考 + JSON 输出"。4000 留足余量，截断时再用 5000 自动重试一次。
const SEARCH_MAX_TOKENS = 4000;
const SEARCH_RETRY_MAX_TOKENS = 5000;
// 视觉模型（qwen3-vl-flash）输出 JSON 较短，1600 足够
const VISION_MAX_TOKENS = 1600;

const PORT = (() => {
  const raw = toInt(envValue("PORT", 8080), 8080);
  if (raw < 1 || raw > 65535) {
    console.warn(`[nutrition] PORT=${raw} 非法，回退到 8080`);
    return 8080;
  }
  return raw;
})();

const HOST = String(envValue("HOST", "127.0.0.1") || "").trim() || "127.0.0.1";
const IS_WILDCARD_HOST = HOST === "0.0.0.0" || HOST === "::" || HOST === "[::]";

const RATE_LIMIT = Math.max(0, toInt(envValue("API_RATE_LIMIT", 30), 30));
const RATE_WINDOW_MIN = Math.max(1, toInt(envValue("API_RATE_WINDOW_MIN", 10), 10));
const RATE_WINDOW_MS = RATE_WINDOW_MIN * 60 * 1000;
const RATE_MAP_MAX = 10000;
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(envValue("TRUST_PROXY", "") || "").trim());

/* ---------- 账号体系与 AI 额度配置（v3.6） ---------- */
// 额度按「登录会话」计：同一浏览器换邮箱仍受原设备额度约束，防止无限注册刷 AI 次数。
// 本地默认 ./.data/app.db；容器内 DATA_DIR=/data/app.db（compose 挂载命名卷 app-data:/data）
const DB_PATH = (() => {
  const raw = String(envValue("DATA_DIR", "") || "").trim();
  if (!raw) return path.join(ROOT, ".data", "app.db");
  // DATA_DIR 指向目录（无扩展名或以分隔符结尾）时自动补 app.db，方便写 /data 或 /data/
  if (/[\\/]$/.test(raw)) return path.join(raw, "app.db");
  const base = path.basename(raw);
  return base.includes(".") ? raw : path.join(raw, "app.db");
})();

// 旧版（≤3.5）按 user_id+day 计数，无法区分同账号多设备；v2 迁移后改为按 session 计数

const SMTP_HOST = String(envValue("SMTP_HOST", "") || "").trim();
const SMTP_PORT = Math.min(65535, Math.max(1, toInt(envValue("SMTP_PORT", 465), 465)));
const SMTP_USER = String(envValue("SMTP_USER", "") || "").trim();
const SMTP_PASS = String(envValue("SMTP_PASS", "") || "").trim();
const MAIL_FROM_NAME = String(envValue("MAIL_FROM_NAME", "每日营养管家") || "").trim() || "每日营养管家";
// QQ 等服务商强制 MAIL FROM 必须等于登录账号
const MAIL_FROM = SMTP_USER;
const AUTH_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM);
// 仅本地调试：把验证码写入服务端日志（生产务必关闭）
const AUTH_DEV_LOG_CODE = /^(1|true|yes|on)$/i.test(String(envValue("AUTH_DEV_LOG_CODE", "") || "").trim());

const SESSION_COOKIE = "nt_session";
const SESSION_TTL_SEC = 30 * 24 * 3600;        // 30 天
// AI 额度按「登录会话」计（session_id + day）：一个浏览器一条会话，换邮箱重登也不重置。
// sessions 表需加 session_id / device_label 两列（见 migrateSchema 的 v2 迁移）。
// 同一浏览器的并发调用由全局串行队列兜底；跨浏览器同 IP 并发极端情况下可能多放行 1 次，可接受。
const CODE_TTL_SEC = 600;                       // 验证码 10 分钟
const CODE_MAX_ATTEMPTS = 5;                    // 每个码最多校验 5 次
const AI_QUOTA_PER_DAY = 5;                     // 每个登录会话每天 5 次 AI 调用
const REQ_CODE_PER_EMAIL_COOLDOWN_SEC = 60;     // 同一邮箱 60 秒一次
const REQ_CODE_PER_EMAIL_PER_DAY = 10;          // 每邮箱每天 10 次
const REQ_CODE_PER_IP_PER_HOUR = 20;            // 每 IP 每小时 20 次

function resolveBaseUrl(raw) {
  const fallback = "https://api.moonshot.cn/v1";
  let text = String(raw || "").trim();
  if (!text) return new URL(fallback);
  // 允许直接写 api.moonshot.cn/v1 这类不带协议的写法
  if (!/^https?:\/\//i.test(text)) text = "https://" + text;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("协议必须是 http:// 或 https://");
    return url;
  } catch (err) {
    console.warn(`[nutrition] KIMI_BASE_URL（${text}）无效，回退到 ${fallback}：${err.message}`);
    return new URL(fallback);
  }
}

const BASE_URL = resolveBaseUrl(envValue("KIMI_BASE_URL", "https://api.moonshot.cn/v1"));
// http:// 与 https:// 上游自适应
const TRANSPORT = BASE_URL.protocol === "http:" ? http : https;
const UPSTREAM_HOST = BASE_URL.hostname.replace(/^\[|\]$/g, "");
const UPSTREAM_PORT = Number(BASE_URL.port) || (BASE_URL.protocol === "http:" ? 80 : 443);
const UPSTREAM_PATH = BASE_URL.pathname.replace(/\/+$/, "") + "/chat/completions";

/** 视觉上游（DashScope OpenAI 兼容）：未配置 VISION_BASE_URL 时回退到文本上游 */
const VISION_BASE = envValue("VISION_BASE_URL", "")
  ? resolveBaseUrl(envValue("VISION_BASE_URL", ""))
  : (() => { const u = new URL(BASE_URL.href); return u; })();
const VISION_TRANSPORT = VISION_BASE.protocol === "http:" ? http : https;
const VISION_UPSTREAM = {
  hostname: VISION_BASE.hostname.replace(/^\[|\]$/g, ""),
  port: Number(VISION_BASE.port) || (VISION_BASE.protocol === "http:" ? 80 : 443),
  path: VISION_BASE.pathname.replace(/\/+$/, "") + "/chat/completions"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

// 即使扩展名在白名单内，也不允许被下载的工程/配置文件
const BLOCKED_BASENAMES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "test-harness.cjs",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  ".env",
  ".env.example"
]);

/* ---------- 队列：串行化上游请求，保证 RPM ---------- */
let chain = Promise.resolve();
let lastCallAt = 0;
let pendingCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function schedule(fn) {
  pendingCount++;
  const run = async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL - Date.now());
    if (wait > 45000) {
      pendingCount--;
      const err = new Error("AI 请求排队较长，请稍后再试");
      err.httpStatus = 429;
      throw err;
    }
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    try {
      return await fn();
    } finally {
      pendingCount--;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/* ---------- 按客户端 IP 的 /api/* 限流（内存） ---------- */
const rateMap = new Map();

function normalizeIp(ip) {
  let s = String(ip || "").trim();
  if (!s) return "unknown";
  if (s.startsWith("::ffff:")) s = s.slice(7);
  if (s === "::1") return "127.0.0.1";
  const v4WithPort = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) s = v4WithPort[1];
  return s;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    if (typeof raw === "string" && raw.trim()) {
      const first = raw.split(",")[0].trim();
      if (first) return normalizeIp(first);
    }
  }
  const socket = req.socket || {};
  return normalizeIp(socket.remoteAddress);
}

function pruneRateMap(now, hard) {
  let removed = 0;
  for (const [key, entry] of rateMap) {
    if (!entry || entry.resetAt <= now) {
      rateMap.delete(key);
      removed++;
    }
  }
  if (hard && rateMap.size >= RATE_MAP_MAX) {
    rateMap.clear();
    console.warn("[nutrition] 限流表跟踪的 IP 过多，已重置计数（请检查是否有异常流量）");
  }
  return removed;
}

/**
 * 检查并消耗一次配额。
 * @returns {{allowed: boolean, ip: string, limit: number, remaining: number, resetAt: number, retryAfterSec: number}}
 */
function checkRateLimit(req) {
  const now = Date.now();
  const ip = clientIp(req);
  if (RATE_LIMIT <= 0) {
    return { allowed: true, ip, limit: 0, remaining: 0, resetAt: 0, retryAfterSec: 0 };
  }
  let entry = rateMap.get(ip);
  if (entry && entry.resetAt <= now) {
    rateMap.delete(ip);
    entry = null;
  }
  if (!entry) {
    if (rateMap.size >= RATE_MAP_MAX) pruneRateMap(now, true);
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateMap.set(ip, entry);
  }
  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT - entry.count);
  const resetAt = entry.resetAt;
  if (entry.count > RATE_LIMIT) {
    return {
      allowed: false,
      ip,
      limit: RATE_LIMIT,
      remaining: 0,
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }
  return { allowed: true, ip, limit: RATE_LIMIT, remaining, resetAt, retryAfterSec: 0 };
}

const ratePruneTimer = setInterval(() => pruneRateMap(Date.now(), false), 60 * 1000);
if (typeof ratePruneTimer.unref === "function") ratePruneTimer.unref();

// 每日清理过期验证码 / 会话 / 历史用量（进程常驻时按 24h 周期；首次执行见 openDb 之后）
const purgeTimer = setInterval(purgeExpired, 24 * 3600 * 1000);
if (typeof purgeTimer.unref === "function") purgeTimer.unref();

/* ---------- 上游调用（http/https 自适应；target 可选，缺省为文本上游） ---------- */
function upstreamPost(payload, target) {
  const t = target || { transport: TRANSPORT, hostname: UPSTREAM_HOST, port: UPSTREAM_PORT, path: UPSTREAM_PATH, key: API_KEY };
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const body = Buffer.from(JSON.stringify(payload), "utf8");
    let req;
    try {
      req = t.transport.request({
        hostname: t.hostname,
        port: t.port,
        path: t.path,
        method: "POST",
        headers: {
          Authorization: "Bearer " + t.key,
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Accept: "application/json"
        }
      }, (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_UPSTREAM_BODY) {
            fail(new Error("AI 返回内容过大"));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => done({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        }));
        res.on("error", fail);
      });
    } catch (err) {
      return fail(err);
    }

    req.on("error", fail);
    req.setTimeout(CALL_TIMEOUT, () => {
      req.destroy(new Error(`AI 请求超时（${Math.round(CALL_TIMEOUT / 1000)} 秒）`));
    });
    req.write(body);
    req.end();
  });
}

function sanitizeUpstream(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/org-[A-Za-z0-9]+/g, "org-***")
    .slice(0, 300);
}

function buildPayload(model, messages, maxTokens) {
  const payload = { model, messages, max_tokens: maxTokens };
  // kimi-k2.6 支持关闭思考；关闭后可避免 reasoning 占满 max_tokens 导致 content 为空
  if (/kimi-k2\.6/.test(model)) payload.thinking = { type: "disabled" };
  return payload;
}

/* ---------- 429（账号并发/频率限制）退避重试 ---------- */
/** 解析上游 Retry-After（秒数或 HTTP 日期）为毫秒；无法解析返回 null */
function parseRetryAfterMs(headers) {
  const raw = headers && headers["retry-after"];
  if (raw === undefined || raw === null || raw === "") return null;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
  const at = Date.parse(String(raw));
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return null;
}

/** 上游 429 文本是否属于账号并发限制（同一组织同一时刻只允许 1 个请求） */
function isConcurrencyLimit(body) {
  // 实测文案：Your account ... request reached max organization concurrency: 1
  return /concurren/i.test(String(body || ""));
}

/** 构造对前端的 429 错误：区分「账号并发限制」与「普通频率限制」，并带 retryAfterSec */
function aiBusyError(concurrency, retryAfterMs) {
  const e = new Error(concurrency
    ? "AI 账号并发限制：同一 Kimi 账号同一时刻只能处理 1 个请求，请关闭其他正在使用该 Key 的客户端（其他浏览器标签页/设备/脚本）后重试"
    : "AI 服务调用频率超限（429），请稍后重试");
  e.httpStatus = 429;
  e.code = concurrency ? "AI_CONCURRENCY_LIMIT" : "AI_RATE_LIMITED";
  e.retryAfterSec = Math.max(1, Math.ceil((retryAfterMs === null ? 1500 : retryAfterMs) / 1000));
  return e;
}

async function callModel(model, messages, maxTokens, opts) {
  const o = opts || {};
  const key = o.apiKey !== undefined ? o.apiKey : API_KEY;
  if (!key) {
    const e = new Error("服务端未配置 AI Key（KIMI_API_KEY / VISION_API_KEY），AI 功能不可用（请在 .env 或环境变量中设置后重启）");
    e.httpStatus = 503;
    throw e;
  }
  const target = o.vision
    ? { transport: VISION_TRANSPORT, hostname: VISION_UPSTREAM.hostname, port: VISION_UPSTREAM.port, path: VISION_UPSTREAM.path, key }
    : null;
  return schedule(async () => {
    let waitedMs = 0;
    let lastConcurrency = false;
    let lastRetryAfterMs = null;
    for (let attempt = 0; attempt < AI_MAX_RETRIES; attempt++) {
      let r;
      try {
        r = await upstreamPost(buildPayload(model, messages, maxTokens), target);
      } catch (err) {
        const e = new Error("无法连接 AI 服务：" + err.message);
        e.httpStatus = 502;
        throw e;
      }
      if (r.status === 200) {
        let json;
        try { json = JSON.parse(r.body); } catch {
          const e = new Error("AI 返回格式异常");
          e.httpStatus = 502;
          throw e;
        }
        const choice = (json.choices && json.choices[0]) || null;
        const msg = choice && choice.message;
        return {
          content: (msg && msg.content) || "",
          usage: json.usage || {},
          model: json.model || model,
          finishReason: (choice && choice.finish_reason) || ""
        };
      }
      if (r.status === 429) {
        const retryAfterMs = parseRetryAfterMs(r.headers);
        const concurrency = isConcurrencyLimit(r.body);
        lastConcurrency = concurrency;
        lastRetryAfterMs = retryAfterMs;
        if (attempt === AI_MAX_RETRIES - 1) break; // 最后一次尝试不再等待

        // 指数退避 1s、1.5s、2.25s…（指数部分上限 8s）；上游给了 retry-after 时优先尊重（可超过 8s），且至少 1s
        const expDelay = Math.min(AI_MAX_BACKOFF_MS, Math.round(AI_BACKOFF_BASE_MS * Math.pow(AI_BACKOFF_FACTOR, attempt)));
        const waitMs = retryAfterMs === null
          ? expDelay
          : Math.max(retryAfterMs, expDelay, AI_BACKOFF_BASE_MS);

        if (waitedMs + waitMs > AI_MAX_TOTAL_WAIT_MS) {
          console.warn(`[ai] 429 重试累计等待将超过 ${Math.round(AI_MAX_TOTAL_WAIT_MS / 1000)}s，提前返回 429（已等待 ${Math.round(waitedMs / 1000)}s）`);
          throw aiBusyError(concurrency, retryAfterMs);
        }
        console.warn(`[ai] 429 ${concurrency ? "账号并发限制" : "频率限制"}，${waitMs}ms 后重试（第 ${attempt + 1}/${AI_MAX_RETRIES} 次尝试）`);
        await sleep(waitMs);
        waitedMs += waitMs;
        continue;
      }
      // 服务端 Key 失效 / 权限不足：HTTP 仍为 502，但给前端可区分的提示
      if (r.status === 401 || r.status === 403) {
        const e = new Error(o.vision
          ? "视觉模型 API Key 无效或权限不足（请检查 VISION_API_KEY）"
          : "服务端 AI Key 无效或权限不足（请检查 KIMI_API_KEY）");
        e.httpStatus = 502;
        e.upstreamStatus = r.status;
        throw e;
      }
      // 模型名不可用 / 参数不合法：提示检查模型配置
      if (r.status === 400 || r.status === 404) {
        const e = new Error("AI 服务拒绝了请求（" + r.status + "），请检查模型名与参数配置：" + sanitizeUpstream(r.body));
        e.httpStatus = 502;
        e.upstreamStatus = r.status;
        throw e;
      }
      const e = new Error("AI 服务返回错误（" + r.status + "）：" + sanitizeUpstream(r.body));
      e.httpStatus = 502;
      e.upstreamStatus = r.status;
      throw e;
    }
    // 所有尝试均为 429（或累计等待超限）：按并发/频率区分返回 429 + retryAfterSec
    throw aiBusyError(lastConcurrency, lastRetryAfterMs);
  });
}

/* ---------- JSON 提取与校验 ---------- */
function extractJson(text) {
  let t = String(text || "").trim();
  // 剥离 ```json ... ``` 代码围栏（qwen 系模型常带，即使 system 已要求只输出 JSON）
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) t = fence[1].trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch {}
  }
  return null;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalizeFoodItems(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  return arr.slice(0, 6).map((it) => {
    const n = it.per100 || {};
    return {
      name: String(it.name || "").trim().slice(0, 60),
      brand: String(it.brand || "").trim().slice(0, 40),
      category: ["主食", "肉蛋", "乳制品", "豆制品", "蔬菜", "水果", "坚果", "零食", "饮料", "速食", "其他"].includes(it.category) ? it.category : "其他",
      per100: {
        kcal: clamp(num(n.kcal || n.calories), 0, 900),
        protein: clamp(num(n.protein), 0, 100),
        carbs: clamp(num(n.carbs), 0, 100),
        fat: clamp(num(n.fat), 0, 100)
      },
      servingGrams: num(it.servingGrams) > 0 ? clamp(num(it.servingGrams), 1, 2000) : null,
      // 常见整包/整袋净含量（g）：与前端的契约，number|null；未知为 null
      packageGrams: num(it.packageGrams) > 0 ? clamp(num(it.packageGrams), 1, 5000) : null,
      note: String(it.note || "").slice(0, 140)
    };
  }).filter(x => x.name);
}

function normalizeEstimateItems(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const items = arr.slice(0, 8).map((it) => {
    let gl = clamp(num(it.gramsLow), 5, 2500);
    let gm = clamp(num(it.gramsMid), 5, 2500);
    let gh = clamp(num(it.gramsHigh), 5, 2500);
    const gs = [gl, gm, gh].sort((a, b) => a - b);
    gl = gs[0]; gm = gs[1]; gh = gs[2];
    let kl = clamp(num(it.kcalLow), 0, 6000);
    let km = clamp(num(it.kcalMid), 0, 6000);
    let kh = clamp(num(it.kcalHigh), 0, 6000);
    const ks = [kl, km, kh].sort((a, b) => a - b);
    kl = ks[0]; km = ks[1]; kh = ks[2];
    return {
      name: String(it.name || "").trim().slice(0, 60),
      gramsLow: Math.round(gl), gramsMid: Math.round(gm), gramsHigh: Math.round(gh),
      kcalLow: Math.round(kl), kcalMid: Math.round(km), kcalHigh: Math.round(kh),
      protein: Math.round(num(it.protein) * 10) / 10,
      carbs: Math.round(num(it.carbs) * 10) / 10,
      fat: Math.round(num(it.fat) * 10) / 10
    };
  }).filter(x => x.name);
  const uncertainty = (Array.isArray(raw && raw.uncertainty) ? raw.uncertainty : []).map(x => String(x).slice(0, 160)).slice(0, 6);
  return { items, uncertainty };
}

/* ---------- 时间工具：day 一律按 UTC+8（Asia/Shanghai 无夏令时） ---------- */
// 注意：本段必须位于 openDb()/purgeExpired() 调用点之前（const 存在 TDZ）
const TZ_OFFSET_MS = 8 * 3600 * 1000;

/** 当前「本地日」YYYY-MM-DD（UTC+8），额度按此归零；接受 Date 或毫秒时间戳 */
function localDay(d) {
  const t = d instanceof Date ? d : new Date(d === undefined ? Date.now() : d);
  return new Date(t.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 距离下一个 UTC+8 午夜的秒数（QUOTA_EXCEEDED 的 retryAfterSec） */
function secondsToNextLocalMidnight(nowMs) {
  const shifted = nowMs + TZ_OFFSET_MS;
  const msToEndOfDay = 86400000 - (shifted % 86400000);
  return Math.max(1, Math.ceil(msToEndOfDay / 1000));
}

/* ---------- 账号体系：SQLite 存储（node:sqlite，零第三方依赖） ---------- */
let db = null;
let dbError = null;

const SCHEMA_VERSION = 2;

/** v1：建表；v2：sessions 加 session_id/device_label，ai_usage 改为按会话计数（旧表数据保留为 *_legacy） */
function migrateSchema(conn) {
  const row = conn.prepare("PRAGMA user_version").get();
  let version = Number(row && row.user_version) || 0;
  if (version >= SCHEMA_VERSION) return version;

  if (version === 0) {
    conn.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at INTEGER NOT NULL,
        ai_quota INTEGER NOT NULL DEFAULT ${AI_QUOTA_PER_DAY}
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS codes (
        email TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('register','reset')),
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (email, purpose)
      );
      CREATE TABLE IF NOT EXISTS ai_usage (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        ip TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day, ip)
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
    version = 1;
  }

  if (version === 1) {
    // 会话身份：session_id 是配额归属键（随机 id，与 token 解耦，登出重登会换新 id）
    conn.exec(`
      BEGIN;
      ALTER TABLE sessions ADD COLUMN session_id TEXT;
      ALTER TABLE sessions ADD COLUMN device_label TEXT;
      UPDATE sessions SET session_id = lower(hex(randomblob(16))) WHERE session_id IS NULL;
      DROP TABLE IF EXISTS ai_usage_v2;
      CREATE TABLE ai_usage_v2 (
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, day)
      );
      -- 旧版按 user+day+ip 聚合到该用户字典序最小的会话（保守：宁可少给也不放大共享 Key）
      INSERT INTO ai_usage_v2 (session_id, user_id, day, count)
        SELECT MIN(s.session_id), u.user_id, u.day, SUM(u.count)
          FROM ai_usage u JOIN sessions s ON s.user_id = u.user_id
         WHERE s.session_id IS NOT NULL
         GROUP BY u.user_id, u.day;
      DROP TABLE ai_usage;
      ALTER TABLE ai_usage_v2 RENAME TO ai_usage;
      CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(day);
      PRAGMA user_version = 2;
      COMMIT;
    `);
    version = 2;
  }
  return version;
}

function openDb() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new DatabaseSync(DB_PATH);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    const v = migrateSchema(conn);
    console.log(`[auth] SQLite 就绪：${DB_PATH}（schema v${v}）`);
    return conn;
  } catch (err) {
    dbError = err;
    console.error("[auth] 数据库初始化失败：" + err.message);
    return null;
  }
}

db = openDb();
purgeExpired(); // 启动即清一次过期数据（放在 db 初始化之后，避免 TDZ）

/** 数据库不可用时拒绝所有 auth 与 AI 调用，避免绕过门禁 */
function requireDb(req, res) {
  if (db) return true;
  sendJson(req, res, 503, { ok: false, message: "服务端存储暂不可用，请稍后重试" });
  return false;
}

/* ---------- 日志脱敏：邮箱打码、授权码绝不外泄 ---------- */
function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  const name = s.slice(0, at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${"*".repeat(Math.max(1, name.length - head.length))}${s.slice(at)}`;
}

/** 任何写入日志/响应的文本都先过一遍：去掉 Key、授权码、完整邮箱 */
function sanitizeLog(text) {
  let s = sanitizeUpstream(text);
  if (SMTP_PASS) s = s.split(SMTP_PASS).join("***");
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => maskEmail(m));
  return s;
}

/* ---------- 最小 SMTP 客户端（内置 tls，465 隐式 TLS） ---------- */
/** EHLO → AUTH LOGIN(base64) → MAIL FROM → RCPT TO → DATA → QUIT */
function smtpSend({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    if (!AUTH_ENABLED) {
      const e = new Error("邮件服务未配置（SMTP_HOST/SMTP_USER/SMTP_PASS）");
      e.httpStatus = 502;
      return reject(e);
    }
    let settled = false;
    let stage = "connect";
    let socket = null;
    let buffer = "";
    let deadline = null;

    // 统一清理：撤监听、销毁 socket（socket=null 后 readReply/write 变为无害空操作）
    const closeSocket = () => {
      try { if (socket) socket.removeAllListeners(); } catch {}
      try { if (socket && !socket.destroyed) socket.destroy(); } catch {}
      socket = null;
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      deadline = null;
      closeSocket();
      fn(value);
    };
    const fail = (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.httpStatus === undefined) {
        e.httpStatus = 502;
        e.smtpStage = stage;
      }
      settle(reject, e);
    };

    // 逐行解析 SMTP 回复：中间行 "NNN-..."，终态行 "NNN ..."（QQ 的 EHLO 是多行）
    const readReply = () => new Promise((res, rej) => {
      if (!socket) return rej(new Error("SMTP 连接已关闭"));
      const onData = (chunk) => {
        buffer += chunk.toString("latin1");
        let m;
        while ((m = buffer.match(/^(\d{3})([ -])([^\r\n]*)(\r?\n)/))) {
          buffer = buffer.slice(m[0].length);
          if (m[2] === " ") {
            detach();
            return res(Number(m[1]));
          }
        }
      };
      const onError = (err) => { detach(); rej(err); };
      const onClose = () => { detach(); rej(new Error("SMTP 连接意外关闭")); };
      const detach = () => {
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        socket.removeListener("close", onClose);
      };
      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
    });

    const write = (line) => { socket.write(line + "\r\n"); };

    const run = async () => {
      const hostname = SMTP_HOST.replace(/^\s*(?:smtp|tls|ssl):\/\//i, "").split("/")[0].trim();
      stage = "connect";
      await new Promise((res, rej) => {
        const onErr = (err) => rej(err);
        const onTimeout = () => rej(new Error("SMTP 连接超时"));
        socket = tls.connect({ host: hostname, port: SMTP_PORT, servername: hostname }, () => {
          socket.removeListener("error", onErr);
          socket.removeListener("timeout", onTimeout);
          res();
        });
        socket.setTimeout(25000);
        socket.once("error", onErr);
        socket.once("timeout", onTimeout);
      });
      socket.removeAllListeners("timeout");
      socket.setTimeout(0);
      socket.on("error", (err) => fail(err));

      stage = "greeting";
      const greet = await readReply();
      if (greet !== 220) throw new Error("SMTP 服务器问候异常（" + greet + "）");

      stage = "ehlo";
      let ehloHost = "localhost";
      try { ehloHost = os.hostname() || "localhost"; } catch {}
      write(`EHLO ${ehloHost}`);
      const ehloCode = await readReply();
      if (ehloCode !== 250) throw new Error("SMTP EHLO 被拒绝（" + ehloCode + "）");

      stage = "auth";
      write("AUTH LOGIN");
      const authStart = await readReply();
      if (authStart !== 334) throw new Error("SMTP 未启用 AUTH LOGIN（" + authStart + "）");
      write(Buffer.from(SMTP_USER, "utf8").toString("base64"));
      const userOk = await readReply();
      if (userOk !== 334) throw new Error("SMTP 账号校验异常（" + userOk + "）");
      write(Buffer.from(SMTP_PASS, "utf8").toString("base64"));
      const passOk = await readReply();
      if (passOk !== 235) throw new Error("SMTP 认证失败：请检查 SMTP_PASS 是否为邮箱「授权码」（" + passOk + "）");

      stage = "mail_from";
      write(`MAIL FROM:<${MAIL_FROM}>`);
      const fromOk = await readReply();
      if (fromOk !== 250) throw new Error("SMTP 拒绝发件人（" + fromOk + "）");

      stage = "rcpt_to";
      write(`RCPT TO:<${to}>`);
      const rcptOk = await readReply();
      if (rcptOk !== 250 && rcptOk !== 251) throw new Error("SMTP 拒绝收件人（" + rcptOk + "）");

      stage = "data";
      write("DATA");
      const dataOk = await readReply();
      if (dataOk !== 354) throw new Error("SMTP 无法开始正文传输（" + dataOk + "）");

      // 正文一律 base64，天然不含裸 CR/LF；标题中的换行做点转义防注入
      const safeSubject = String(subject).replace(/\r?\n/g, " ").replace(/\./g, "..").slice(0, 100);
      const headers = [
        `From: ${MAIL_FROM_NAME} <${MAIL_FROM}>`,
        `To: <${to}>`,
        `Subject: ${safeSubject}`,
        "Date: " + new Date().toUTCString(),
        "Message-ID: <" + crypto.randomBytes(12).toString("hex") + "@" + (hostname.split(".")[0] || "localhost") + ">",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64"
      ].join("\r\n");
      const bodyB64 = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
      write(headers + "\r\n\r\n" + bodyB64);
      write(".");
      const endOk = await readReply();
      if (endOk !== 250) throw new Error("SMTP 退信（" + endOk + "）");

      stage = "quit";
      try { write("QUIT"); } catch {}
      settle(resolve, true);
      // 成功路径不立即 destroy：给 QUIT 一点时间发出，1s 后清理
      const t = setTimeout(closeSocket, 1000);
      if (typeof t.unref === "function") t.unref();
    };

    run().catch(fail);

    deadline = setTimeout(() => {
      const e = new Error("SMTP 发送超时");
      e.httpStatus = 502;
      e.smtpStage = stage;
      settle(reject, e);
    }, 30000);
    if (typeof deadline.unref === "function") deadline.unref();
  });
}

/* ---------- 验证码与会话的密码学原语 ---------- */
const scryptCache = new Map(); // salt(hex) -> key(Buffer)，供同步 timingSafeEqual 使用

function hashCode(code, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(code), salt, 32);
  return `${salt}$${key.toString("hex")}`;
}

function verifyCodeHash(code, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 2) return false;
  const salt = parts[0];
  const expected = Buffer.from(parts[1], "hex");
  // 缓存的是「输入 code 在该 salt 下的派生值」，命中即省去一次 scrypt；比较对象始终是库中哈希
  let actual = scryptCache.get(salt + "|" + String(code));
  if (!actual) {
    actual = crypto.scryptSync(String(code), salt, 32);
    if (scryptCache.size > 512) {
      for (const k of scryptCache.keys()) { scryptCache.delete(k); break; }
    }
    scryptCache.set(salt + "|" + String(code), actual);
  }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const sha256hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function newUserId() {
  return (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")).replace(/-/g, "");
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function normalizeEmail(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s || s.length > 254) return null;
  if (!EMAIL_RE.test(s)) return null;
  return s;
}

/** 从 Cookie 头解析 nt_session 值 */
function readSessionCookie(req) {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || !raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v || null;
  }
  return null;
}

/** 会话有效则返回 {userId, email, quotaTotal, sessionId}，否则 null */
function getSessionUser(req) {
  if (!db) return null;
  const token = readSessionCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  // v2 迁移前的旧行 session_id 可能为 NULL：视为需重新登录（401），避免配额键为 null
  const row = db.prepare(
    `SELECT s.user_id AS userId, s.session_id AS sessionId, u.email AS email, u.ai_quota AS quota
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.session_id IS NOT NULL`
  ).get(sha256hex(token), Date.now());
  if (!row) return null;
  return {
    userId: row.userId,
    sessionId: row.sessionId,
    email: row.email,
    quotaTotal: Number(row.quota) || AI_QUOTA_PER_DAY
  };
}

function createSession(userId, deviceLabel) {
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, session_id, device_label) VALUES (?, ?, ?, ?, ?)")
    .run(sha256hex(token), userId, Date.now() + SESSION_TTL_SEC * 1000, sessionId, String(deviceLabel || "").slice(0, 120));
  return { token, sessionId };
}

/** 当日（UTC+8）该会话已用次数 */
function usedToday(sessionId) {
  const row = db.prepare("SELECT count AS c FROM ai_usage WHERE session_id = ? AND day = ?")
    .get(sessionId, localDay());
  return row ? Number(row.c) || 0 : 0;
}

function bumpUsage(sessionId, userId) {
  db.prepare(
    `INSERT INTO ai_usage (session_id, user_id, day, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(session_id, day) DO UPDATE SET count = count + 1`
  ).run(sessionId, userId, localDay());
}

function quotaPayload(sessionId, total) {
  const used = usedToday(sessionId);
  return { remaining: Math.max(0, total - used), total, usedToday: used };
}

/* ---------- auth 独立限流（内存 map，重启清零可接受；不计入 /api/* 全局限流） ---------- */
const authRateMap = new Map();

function authConsume(kind, key, limit, windowMs) {
  const now = Date.now();
  let entry = authRateMap.get(kind + "|" + key);
  if (entry && entry.resetAt <= now) entry = null;
  if (!entry) {
    if (authRateMap.size >= RATE_MAP_MAX) pruneAuthRateMap(now, true);
    entry = { count: 0, resetAt: now + windowMs };
    authRateMap.set(kind + "|" + key, entry);
  }
  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function pruneAuthRateMap(now, hard) {
  for (const [key, entry] of authRateMap) {
    if (!entry || entry.resetAt <= now) authRateMap.delete(key);
  }
  if (hard && authRateMap.size >= RATE_MAP_MAX) {
    authRateMap.clear();
    console.warn("[auth] 限流表过大，已重置计数");
  }
}

/* ---------- 每日清理过期 codes / sessions ---------- */
function purgeExpired() {
  if (!db) return;
  try {
    const now = Date.now();
    const c = db.prepare("DELETE FROM codes WHERE expires_at < ?").run(now).changes;
    const s = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
    const u = db.prepare("DELETE FROM ai_usage WHERE day < ?").run(localDay(new Date(now - 2 * 86400000))).changes;
    if (c || s || u) console.log(`[auth] 清理过期数据：codes=${c} sessions=${s} usage=${u}`);
  } catch (err) {
    console.warn("[auth] 清理过期数据失败：" + err.message);
  }
}

/* ---------- auth API 处理 ---------- */
async function authRequestCode(req, res, payload) {
  if (!requireDb(req, res)) return;
  if (!AUTH_ENABLED) {
    return sendJson(req, res, 503, { ok: false, message: "邮件服务未配置，暂时无法发送验证码（请设置 SMTP_HOST/SMTP_USER/SMTP_PASS）" });
  }
  const email = normalizeEmail(payload.email);
  if (!email) {
    return sendJson(req, res, 400, { ok: false, message: "邮箱格式不正确，请填写有效的邮箱地址" });
  }
  const ip = clientIp(req);
  const cooldown = authConsume("code_mail_cd", email, 1, REQ_CODE_PER_EMAIL_COOLDOWN_SEC * 1000);
  if (!cooldown.allowed) {
    return sendJson(req, res, 429, {
      ok: false,
      code: "CODE_COOLDOWN",
      message: `发送太频繁，请 ${cooldown.retryAfterSec} 秒后再试`,
      retryAfterSec: cooldown.retryAfterSec
    });
  }
  const perDay = authConsume("code_mail_day:" + localDay(), email, REQ_CODE_PER_EMAIL_PER_DAY, 86400000);
  if (!perDay.allowed) {
    return sendJson(req, res, 429, {
      ok: false,
      code: "CODE_DAILY_LIMIT",
      message: "该邮箱今日申请验证码次数已达上限，请明天再试",
      retryAfterSec: perDay.retryAfterSec
    });
  }
  const perIp = authConsume("code_ip_hour", ip, REQ_CODE_PER_IP_PER_HOUR, 3600 * 1000);
  if (!perIp.allowed) {
    return sendJson(req, res, 429, {
      ok: false,
      code: "CODE_IP_LIMIT",
      message: "当前网络今日申请验证码次数过多，请稍后再试",
      retryAfterSec: perIp.retryAfterSec
    });
  }

  const code = String(crypto.randomInt(100000, 999999));
  db.prepare(
    `INSERT INTO codes (email, purpose, code_hash, expires_at, attempts)
     VALUES (?, 'register', ?, ?, 0)
     ON CONFLICT(email, purpose)
     DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`
  ).run(email, hashCode(code), Date.now() + CODE_TTL_SEC * 1000);

  const text = [
    `【${MAIL_FROM_NAME}】`,
    "",
    `你的登录验证码是：${code}`,
    "",
    "验证码 10 分钟内有效，仅可使用一次；请勿转发或告知他人。",
    "如果你没有申请登录，直接忽略本邮件即可，不会产生任何影响。",
    "",
    `—— ${MAIL_FROM_NAME}`
  ].join("\n");

  try {
    await smtpSend({ to: email, subject: `${MAIL_FROM_NAME} 登录验证码`, text });
  } catch (err) {
    // 发送失败：撤销刚落库的码，避免用户以为已发出
    try { db.prepare("DELETE FROM codes WHERE email = ? AND purpose = 'register'").run(email); } catch {}
    console.error("[auth] 发送验证码失败 mail_from=" + maskEmail(MAIL_FROM) + " to=" + maskEmail(email) +
      " stage=" + (err.smtpStage || "?") + "：" + sanitizeLog(err.message));
    return sendJson(req, res, 502, {
      ok: false,
      code: "MAIL_SEND_FAILED",
      message: "验证码邮件发送失败（" + (err.smtpStage || "smtp") + "），请稍后重试或联系管理员检查邮件服务配置"
    });
  }

  if (AUTH_DEV_LOG_CODE) {
    console.log(`[auth][dev] 验证码已发送至 ${maskEmail(email)}：${code}`);
  } else {
    console.log(`[auth] 验证码已发送至 ${maskEmail(email)}`);
  }
  return sendJson(req, res, 200, { ok: true, expiresInSec: CODE_TTL_SEC });
}

function authVerify(req, res, payload) {
  if (!requireDb(req, res)) return;
  const email = normalizeEmail(payload.email);
  if (!email) {
    return sendJson(req, res, 400, { ok: false, message: "邮箱格式不正确，请填写有效的邮箱地址" });
  }
  const code = String(payload.code == null ? "" : payload.code).trim();
  if (!/^\d{6}$/.test(code)) {
    return sendJson(req, res, 400, { ok: false, message: "请输入 6 位数字验证码" });
  }
  const ip = clientIp(req);
  const throttled = authConsume("verify_ip", ip, 30, 3600 * 1000);
  if (!throttled.allowed) {
    return sendJson(req, res, 429, { ok: false, code: "VERIFY_THROTTLED", message: "验证尝试过于频繁，请稍后再试", retryAfterSec: throttled.retryAfterSec });
  }

  const row = db.prepare("SELECT code_hash, expires_at, attempts FROM codes WHERE email = ? AND purpose = 'register'").get(email);
  if (!row) {
    return sendJson(req, res, 400, { ok: false, code: "CODE_NOT_FOUND", message: "验证码不存在或已重新发送，请重新获取" });
  }
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM codes WHERE email = ? AND purpose = 'register'").run(email);
    return sendJson(req, res, 400, { ok: false, code: "CODE_EXPIRED", message: "验证码已过期，请重新获取" });
  }
  const attempts = Number(row.attempts) || 0;
  if (attempts >= CODE_MAX_ATTEMPTS) {
    db.prepare("DELETE FROM codes WHERE email = ? AND purpose = 'register'").run(email);
    return sendJson(req, res, 400, { ok: false, code: "CODE_LOCKED", message: "验证码错误次数过多已作废，请重新获取" });
  }
  if (!verifyCodeHash(code, row.code_hash)) {
    const left = CODE_MAX_ATTEMPTS - attempts - 1;
    db.prepare("UPDATE codes SET attempts = attempts + 1 WHERE email = ? AND purpose = 'register'").run(email);
    return sendJson(req, res, 400, {
      ok: false,
      code: "CODE_INVALID",
      message: left > 0 ? `验证码不正确，还可尝试 ${left} 次` : "验证码错误次数过多已作废，请重新获取"
    });
  }

  // 一次性使用：无论后续如何都删除该码
  db.prepare("DELETE FROM codes WHERE email = ? AND purpose = 'register'").run(email);

  let user = db.prepare("SELECT id, email, ai_quota AS quota FROM users WHERE email = ?").get(email);
  if (!user) {
    const id = newUserId();
    try {
      db.prepare("INSERT INTO users (id, email, created_at, ai_quota) VALUES (?, ?, ?, ?)")
        .run(id, email, Date.now(), AI_QUOTA_PER_DAY);
    } catch (insErr) {
      // 并发注册撞 UNIQUE：回读既有行即可
      const existing = db.prepare("SELECT id, email, ai_quota AS quota FROM users WHERE email = ?").get(email);
      if (!existing) throw insErr;
      user = existing;
    }
    if (!user) user = { id, email, quota: AI_QUOTA_PER_DAY };
  }
  const sess = createSession(user.id, req.headers["user-agent"]);
  const quota = quotaPayload(sess.sessionId, Number(user.quota) || AI_QUOTA_PER_DAY);
  console.log(`[auth] 登录成功 ${maskEmail(email)}（ip=${ip}）`);
  return sendJson(req, res, 200, { ok: true, user: { email: user.email, quota } }, {
    "Set-Cookie": `${SESSION_COOKIE}=${sess.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`
  });
}

function authMe(req, res) {
  if (!requireDb(req, res)) return;
  const user = getSessionUser(req);
  if (!user) {
    return sendJson(req, res, 401, { ok: false, code: "NOT_LOGGED_IN", message: "尚未登录" });
  }
  const quota = quotaPayload(user.sessionId, user.quotaTotal);
  return sendJson(req, res, 200, { ok: true, user: { email: user.email, quota } });
}

function authLogout(req, res) {
  if (!requireDb(req, res)) return;
  const token = readSessionCookie(req);
  if (token) {
    try { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256hex(token)); } catch {}
  }
  return sendJson(req, res, 200, { ok: true }, {
    "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  });
}

/** AI 端点门禁：未登录 401 LOGIN_REQUIRED；当日额度用完 429 QUOTA_EXCEEDED（按会话计） */
function gateAi(req, res) {
  if (!db) return null;
  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { ok: false, code: "LOGIN_REQUIRED", message: "请先注册登录后使用 AI 功能" });
    return null;
  }
  const total = user.quotaTotal;
  const used = usedToday(user.sessionId);
  if (used >= total) {
    const retryAfterSec = secondsToNextLocalMidnight(Date.now());
    res.setHeader("Retry-After", String(retryAfterSec));
    sendJson(req, res, 429, {
      ok: false,
      code: "QUOTA_EXCEEDED",
      message: `今日 AI 试用额度（${total} 次）已用完，请明天再来`,
      retryAfterSec
    });
    return null;
  }
  return { user, total };
}

/* ---------- API 处理 ---------- */
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

/** 调一次文本模型并解析 JSON，同时带回 finish_reason 以便识别"被截断" */
async function searchAttempt(messages, maxTokens) {
  const r = await callModel(TEXT_MODEL, messages, maxTokens);
  return {
    parsed: extractJson(r.content),
    truncated: r.finishReason === "length",
    model: r.model,
    finishReason: r.finishReason
  };
}

async function foodSearch(query) {
  const q = String(query || "").trim().slice(0, 80);
  if (q.length < 1) {
    const e = new Error("请输入要查询的食品名称");
    e.httpStatus = 400;
    throw e;
  }
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { items: hit.items, cached: true, model: hit.model };
  }
  const prompt = `查询：${q}
请返回最多 4 个最匹配的食品。只输出 JSON，格式：
{"items":[{"name":"","brand":"","category":"主食|肉蛋|乳制品|豆制品|蔬菜|水果|坚果|零食|饮料|速食|其他","per100":{"kcal":0,"protein":0,"carbs":0,"fat":0},"servingGrams":null,"packageGrams":null,"note":""}]}
规则：brand 仅在查询包含品牌时填写，否则空字符串；不要编造不存在的品牌或商品；servingGrams 为常见每份克数，未知填 null；packageGrams 为常见整包/整袋净含量（克），未知或非预包装食品填 null；note 简短说明数据来源与置信度；数值为每 100g/100ml 参考值。`;
  const messages = [
    { role: "system", content: "你是营养数据库助手。只输出 JSON，不要 Markdown 代码块，不要解释。" },
    { role: "user", content: prompt }
  ];
  // 文本模型带 reasoning（qwen3.7-flash 思考约占 300 token，kimi-k2.7-code 更多），
  // max_tokens 需覆盖"思考 + JSON 输出"：首次给 4000，仍因 length 截断时用 5000 自动重试一次。
  let attempt = await searchAttempt(messages, SEARCH_MAX_TOKENS);
  if (!attempt.parsed && attempt.truncated) {
    console.warn(`[api] food-search 输出被截断（max_tokens=${SEARCH_MAX_TOKENS}），用 ${SEARCH_RETRY_MAX_TOKENS} 重试一次`);
    attempt = await searchAttempt(messages, SEARCH_RETRY_MAX_TOKENS);
  }
  if (!attempt.parsed) {
    const e = new Error(attempt.truncated
      ? "AI 输出被截断（reasoning 占用过多），请重试或改用更短的查询"
      : "AI 未能返回可解析的营养数据，请换个说法重试");
    e.httpStatus = 502;
    throw e;
  }
  const items = normalizeFoodItems(attempt.parsed);
  if (!items.length) {
    const e = new Error("没有找到匹配的食品，请尝试更具体的名称");
    e.httpStatus = 404;
    throw e;
  }
  searchCache.set(key, { at: Date.now(), items, model: attempt.model });
  return { items, cached: false, model: attempt.model };
}

async function estimatePhoto(payload) {
  const image = String(payload.image || "");
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    const e = new Error("请提供有效的图片（PNG/JPEG/WebP）");
    e.httpStatus = 400;
    throw e;
  }
  if (image.length > 12 * 1024 * 1024) {
    const e = new Error("图片过大，请压缩后再试");
    e.httpStatus = 413;
    throw e;
  }
  const reference = String(payload.reference || "未说明参照物").slice(0, 120);
  const description = String(payload.description || "未补充描述").slice(0, 500);
  const cookMethod = String(payload.cookMethod || "未说明").slice(0, 40);
  const hints = Array.isArray(payload.hints) ? payload.hints.slice(0, 8).map(x => String(x).slice(0, 60)) : [];

  const text = `参照物：${reference}
用户补充：${description}
烹饪方式：${cookMethod}
用户提到的食物：${hints.length ? hints.join("、") : "未指定"}

请识别图片中的食物（可多种），分别估算可食部分的重量和营养。只输出 JSON：
{"items":[{"name":"","gramsLow":0,"gramsMid":0,"gramsHigh":0,"kcalLow":0,"kcalMid":0,"kcalHigh":0,"protein":0,"carbs":0,"fat":0}],"uncertainty":["影响准确度的因素"]}
要求：
1. 重量为可食部分克数，必须给出区间；能量给出区间；蛋白质/碳水/脂肪给出中值。
2. 结合参照物尺寸、食物可见面积与厚度、烹饪方式（额外用油、酱汁）估算。
3. 无法确认的食物不要编造；无法判断时 items 为空，并在 uncertainty 说明。
4. 不要声称精确测量，区间要体现真实不确定性。`;

  const r = await callModel(VISION_MODEL, [
    { role: "system", content: "你是营养估算助手。只输出 JSON，不要 Markdown 代码块，不要解释。" },
    {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ], VISION_MAX_TOKENS, { vision: true, apiKey: VISION_API_KEY });
  const parsed = extractJson(r.content);
  if (!parsed) {
    // qwen3-vl-flash 输出 JSON 较短，1600 通常足够；万一 length 截断给出可区分提示
    const e = new Error(r.finishReason === "length"
      ? "AI 输出被截断（图片信息过于复杂），请重试或改用本地几何估算"
      : "AI 未能返回可解析的估算结果，请重试或改用本地估算");
    e.httpStatus = 502;
    throw e;
  }
  const out = normalizeEstimateItems(parsed);
  if (!out.items.length) {
    const e = new Error(out.uncertainty[0] || "未能从图片中识别出食物，请补充描述或换一张照片");
    e.httpStatus = 422;
    throw e;
  }
  return { ...out, model: r.model };
}

/* ---------- 营养成分表照片识别（AI 标签扫描） ---------- */
const LABEL_MAX_TOKENS = 2000;

/** 归一化标签识别结果：字段缺失一律 null，绝不编造 */
function normalizeLabelResult(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const n = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const p = o.per100 && typeof o.per100 === "object" ? o.per100 : {};
  const basis = ["100g", "100ml", "serving"].includes(o.basis) ? o.basis : "100g";
  let kcal = n(p.kcal);
  const kj = n(p.energyKj);
  if (kcal === null && kj !== null) kcal = Math.round(kj / 4.184);
  const warnings = Array.isArray(o.warnings) ? o.warnings.map(x => String(x).slice(0, 160)).filter(Boolean).slice(0, 8) : [];
  return {
    productName: String(o.productName || "").trim().slice(0, 80),
    brand: String(o.brand || "").trim().slice(0, 40),
    netContentGrams: n(o.netContentGrams),
    basis,
    per100: {
      energyKj: kj, kcal,
      protein: n(p.protein), fat: n(p.fat), saturatedFat: n(p.saturatedFat),
      carbs: n(p.carbs), sugar: n(p.sugar), fiber: n(p.fiber), sodiumMg: n(p.sodiumMg)
    },
    ingredients: (Array.isArray(o.ingredients) ? o.ingredients : []).map(x => String(x).slice(0, 60)).filter(Boolean).slice(0, 15),
    warnings
  };
}

async function scanLabel(payload) {
  const image = String(payload.image || "");
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    const e = new Error("请提供有效的图片（PNG/JPEG/WebP）");
    e.httpStatus = 400;
    throw e;
  }
  if (image.length > 12 * 1024 * 1024) {
    const e = new Error("图片过大，请压缩后再试");
    e.httpStatus = 413;
    throw e;
  }
  const prompt = [
    "这是一张食品包装背面的照片。请提取以下信息，只输出 JSON（不要 Markdown 代码块）：",
    '{"productName":"","brand":"","netContentGrams":null,"basis":"100g|100ml|serving","per100":{"energyKj":null,"kcal":null,"protein":null,"fat":null,"saturatedFat":null,"carbs":null,"sugar":null,"fiber":null,"sodiumMg":null},"ingredients":[],"warnings":["图片中看不清或缺失的信息"]}',
    "规则：",
    "1. netContentGrams 为整包净含量换算成克（如 1.4千克=1400；液体按 ml 数值填）。",
    "2. kcal 按能量千焦/4.184 换算后四舍五入到整数。",
    "3. basis 标注营养成分表的基准（每100克/每100毫升/每份）。",
    "4. 看不清或没有的字段填 null，不要编造；模糊的字放进 warnings 说明。",
    "5. ingredients 为配料表按顺序拆分（可只取前 10 项）。"
  ].join("\n");
  const r = await callModel(VISION_MODEL, [
    { role: "system", content: "你是食品包装标签识别助手。只输出 JSON。" },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ], LABEL_MAX_TOKENS, { vision: true, apiKey: VISION_API_KEY });
  const parsed = extractJson(r.content);
  if (!parsed) {
    const e = new Error(r.finishReason === "length"
      ? "AI 输出被截断（标签信息过于复杂），请拍近一点重试"
      : "未能从图片中识别出营养标签，请对准「营养成分表」重新拍摄");
    e.httpStatus = 502;
    throw e;
  }
  const out = normalizeLabelResult(parsed);
  if (!out.productName && !Object.values(out.per100).some(v => v !== null)) {
    const e = new Error("图片中未识别到商品信息，请上传清晰的包装背面营养成分表照片");
    e.httpStatus = 422;
    throw e;
  }
  return { ...out, model: r.model };
}

/* ---------- 响应工具 ---------- */
function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // 保留原有语义：所有响应都不缓存，改完刷新即可看到变化
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(req, res, status, obj, extraHeaders) {
  if (res.writableEnded) return;
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length
  }, extraHeaders || {}));
  if (req.method === "HEAD") return res.end();
  res.end(buf);
}

function sendText(req, res, status, text, extraHeaders) {
  if (res.writableEnded) return;
  const buf = Buffer.from(String(text), "utf8");
  res.writeHead(status, Object.assign({
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": buf.length
  }, extraHeaders || {}));
  if (req.method === "HEAD") return res.end();
  res.end(buf);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        // 不立即 destroy：先丢弃剩余数据，保证还能把 413 响应写回客户端
        tooLarge = true;
        chunks.length = 0;
        const e = new Error("请求体过大");
        e.httpStatus = 413;
        reject(e);
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function healthPayload() {
  return {
    ok: true,
    name: "nutrition-tracker",
    version: VERSION,
    host: HOST,
    port: PORT,
    textModel: TEXT_MODEL,
    visionModel: VISION_MODEL,
    // 便于部署排查：实际生效的模型与输出预算（文本模型带 reasoning，预算需覆盖思考）
    models: { text: TEXT_MODEL, vision: VISION_MODEL },
    maxTokens: { search: SEARCH_MAX_TOKENS, searchRetry: SEARCH_RETRY_MAX_TOKENS, vision: VISION_MAX_TOKENS },
    vision: true,
    rpm: RPM,
    queue: pendingCount,
    hasApiKey: Boolean(API_KEY),
    // 视觉模型独立供应商（默认阿里云百炼 qwen3-vl-flash）
    visionProvider: { model: VISION_MODEL, baseUrl: VISION_BASE.href, hasApiKey: Boolean(VISION_API_KEY) },
    labelScan: Boolean(VISION_API_KEY || API_KEY),
    // 429（账号并发/频率限制）重试配置，便于排查
    aiRetry: {
      maxRetries: AI_MAX_RETRIES,
      maxBackoffMs: AI_MAX_BACKOFF_MS,
      maxTotalWaitSec: Math.round(AI_MAX_TOTAL_WAIT_MS / 1000),
      upConcurrencyHint: "同一 Kimi 账号同一时刻只允许 1 个并发请求；会按 retry-after/指数退避自动重试"
    },
    rateLimit: {
      enabled: RATE_LIMIT > 0,
      limit: RATE_LIMIT,
      windowMin: RATE_WINDOW_MIN,
      trustProxy: TRUST_PROXY
    },
    // 账号体系与 AI 额度（v3.6）：mailProvider 摘要不含任何密钥/授权码
    authEnabled: AUTH_ENABLED,
    mailProvider: {
      host: SMTP_HOST || null,
      port: SMTP_PORT,
      user: SMTP_USER ? maskEmail(SMTP_USER) : null,
      configured: AUTH_ENABLED,
      error: dbError ? "数据库初始化失败" : null
    },
    aiQuota: {
      perDay: AI_QUOTA_PER_DAY,
      scope: "session",        // 按登录会话（浏览器设备）计数，day 为 UTC+8
      timezone: "UTC+8",
      storage: db ? "sqlite" : "unavailable"
    },
    uptimeSec: Math.round(process.uptime())
  };
}

async function handleApi(req, res, pathname) {
  const isHealth = pathname === "/api/health" && (req.method === "GET" || req.method === "HEAD");

  // auth 端点走独立限流（见 authConsume），不计入 /api/* 全局 IP 限流，否则用户会被自己的请求锁死
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return handleAuthApi(req, res, pathname);
  }

  // /api/health 不计入限流（前端探测与 Docker HEALTHCHECK 会周期性调用）
  if (!isHealth) {
    const rate = checkRateLimit(req);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      return sendJson(req, res, 429, {
        ok: false,
        message: `请求过于频繁：每个客户端每 ${RATE_WINDOW_MIN} 分钟最多 ${rate.limit} 次，请 ${rate.retryAfterSec} 秒后再试`,
        retryAfterSec: rate.retryAfterSec,
        limit: rate.limit,
        windowMin: RATE_WINDOW_MIN
      });
    }
  }

  if (isHealth) return sendJson(req, res, 200, healthPayload());

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(req, res, 405, { ok: false, message: "Method Not Allowed：该接口仅支持 POST" });
  }

  // AI 门禁：未登录 401 LOGIN_REQUIRED；当日额度用完 429 QUOTA_EXCEEDED（按会话计）
  const aiEndpoints = ["/api/food-search", "/api/estimate-photo", "/api/scan-label"];
  let gate = null;
  if (aiEndpoints.includes(pathname)) {
    if (!requireDb(req, res)) return;
    gate = gateAi(req, res);
    if (!gate) return;
  }

  const handler =
    pathname === "/api/food-search" ? (p) => foodSearch(p.query) :
    pathname === "/api/estimate-photo" ? (p) => estimatePhoto(p) :
    pathname === "/api/scan-label" ? (p) => scanLabel(p) :
    null;
  if (!handler) return sendJson(req, res, 404, { ok: false, message: "未知接口" });

  let payload;
  try {
    const raw = await readBody(req, 14 * 1024 * 1024);
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    const status = err.httpStatus || 400;
    return sendJson(req, res, status, { ok: false, message: "请求格式错误：" + err.message });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return sendJson(req, res, 400, { ok: false, message: "请求格式错误：请求体必须是 JSON 对象" });
  }

  try {
    const out = await handler(payload);
    // 成功调用才计入额度（缓存命中同样计一次）
    let quotaHeader = null;
    if (gate) {
      bumpUsage(gate.user.sessionId, gate.user.userId);
      const used = usedToday(gate.user.sessionId);
      quotaHeader = { remaining: Math.max(0, gate.total - used), total: gate.total, usedToday: used };
      res.setHeader("X-AI-Quota-Remaining", String(quotaHeader.remaining));
    }
    return sendJson(req, res, 200, quotaHeader ? { ok: true, ...out, quota: quotaHeader } : { ok: true, ...out });
  } catch (err) {
    const status = err.httpStatus || 500;
    console.error("[api]", pathname, status, sanitizeLog(err.message));
    const body = { ok: false, message: sanitizeLog(err.message) || "AI 服务异常" };
    if (err.code) body.code = err.code;
    if (err.retryAfterSec) {
      // 429（账号并发/频率限制）时回传 retryAfterSec，前端可据此提示等待时长
      body.retryAfterSec = err.retryAfterSec;
      res.setHeader("Retry-After", String(err.retryAfterSec));
    }
    return sendJson(req, res, status, body);
  }
}

/** /api/auth/* 路由：request-code / verify / me / logout */
async function handleAuthApi(req, res, pathname) {
  const route = pathname.slice("/api/auth".length).replace(/^\/+/, "");
  const methods = {
    "request-code": "POST",
    verify: "POST",
    me: "GET",
    logout: "POST"
  };
  if (!Object.prototype.hasOwnProperty.call(methods, route)) {
    return sendJson(req, res, 404, { ok: false, message: "未知接口" });
  }
  const allow = methods[route];
  if (req.method !== allow && !(req.method === "HEAD" && allow === "GET")) {
    res.setHeader("Allow", allow);
    return sendJson(req, res, 405, { ok: false, message: `Method Not Allowed：该接口仅支持 ${allow}` });
  }
  if (!db) {
    return sendJson(req, res, 503, { ok: false, message: "服务端存储暂不可用，请稍后重试" });
  }

  let payload = {};
  if (allow === "POST") {
    try {
      const raw = await readBody(req, 64 * 1024);
      payload = JSON.parse(raw || "{}");
    } catch (err) {
      const status = err.httpStatus || 400;
      return sendJson(req, res, status, { ok: false, message: "请求格式错误：" + sanitizeLog(err.message) });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return sendJson(req, res, 400, { ok: false, message: "请求格式错误：请求体必须是 JSON 对象" });
    }
  }

  try {
    if (route === "request-code") return await authRequestCode(req, res, payload);
    if (route === "verify") return authVerify(req, res, payload);
    if (route === "me") return authMe(req, res);
    return authLogout(req, res);
  } catch (err) {
    console.error("[auth]", pathname, sanitizeLog(err && err.stack ? err.stack : String(err)));
    return sendJson(req, res, 500, { ok: false, message: "服务器内部错误" });
  }
}

/* ---------- 静态文件 ---------- */
function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === "/" || rel === "") rel = "/index.html";
  // 任何以 "." 开头的路径段都不可访问（.env、.git、隐藏目录等）
  if (rel.split("/").some((seg) => seg.startsWith("."))) {
    return sendText(req, res, 404, "404 Not Found");
  }

  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    return sendText(req, res, 403, "403 Forbidden");
  }

  const base = path.basename(file).toLowerCase();
  if (BLOCKED_BASENAMES.has(base)) return sendText(req, res, 404, "404 Not Found");

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) return sendText(req, res, 404, "404 Not Found");

  fs.realpath(file, (err, real) => {
    if (err) return sendText(req, res, 404, "404 Not Found");
    // 防符号链接逃逸出项目目录
    if (real !== ROOT_REAL && !real.startsWith(ROOT_REAL + path.sep)) {
      return sendText(req, res, 403, "403 Forbidden");
    }
    fs.readFile(real, (readErr, buf) => {
      if (readErr) return sendText(req, res, 404, "404 Not Found");
      res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
      if (req.method === "HEAD") return res.end();
      res.end(buf);
    });
  });
}

/* ---------- 请求分发（含兜底，避免单请求异常杀掉进程） ---------- */
async function handleRequest(req, res) {
  applySecurityHeaders(res);
  res.on("error", (err) => {
    console.error("[server] 响应写入失败：" + (err && err.message));
  });

  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    return sendText(req, res, 400, "400 Bad Request：请求地址无效");
  }
  // 关键修复：畸形百分号编码（如 /%E0%A4%A）会让 decodeURIComponent 抛 URIError
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return sendText(req, res, 400, "400 Bad Request：URL 编码无效");
  }
  if (pathname.includes("\0")) return sendText(req, res, 400, "400 Bad Request：URL 包含非法字符");

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return handleApi(req, res, pathname);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(req, res, 405, "405 Method Not Allowed", { Allow: "GET, HEAD" });
  }
  return serveStatic(req, res, pathname);
}

/* ---------- 启动 ---------- */
const server = http.createServer((req, res) => {
  // 同步异常与异步 Promise 拒绝都在这里兜底
  Promise.resolve()
    .then(() => handleRequest(req, res))
    .catch((err) => {
      console.error("[server] 请求处理异常：", err && err.stack ? err.stack : err);
      try {
        if (!res.headersSent) sendJson(req, res, 500, { ok: false, message: "服务器内部错误" });
        else if (!res.writableEnded) res.end();
      } catch (writeErr) {
        console.error("[server] 兜底响应失败：" + writeErr.message);
        try { res.destroy(); } catch {}
      }
    });
});

server.requestTimeout = 120000;   // 接收完整请求的上限
server.headersTimeout = 30000;    // 请求头超时（需 <= requestTimeout）
server.keepAliveTimeout = 65000;  // 略大于常见反向代理的 60s 空闲超时

server.on("clientError", (err, socket) => {
  if (!socket || socket.destroyed || !socket.writable) {
    if (socket && !socket.destroyed) socket.destroy();
    return;
  }
  const status = err && err.code === "HPE_HEADER_OVERFLOW"
    ? "431 Request Header Fields Too Large"
    : "400 Bad Request";
  try {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    socket.destroy();
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[nutrition] 端口 ${PORT} 已被占用，请改用其他端口（例如 PORT=8092）`);
  } else if (err.code === "EACCES") {
    console.error(`[nutrition] 没有权限监听 ${HOST}:${PORT}（1024 以下端口通常需要管理员权限）`);
  } else if (err.code === "EADDRNOTAVAIL") {
    console.error(`[nutrition] 无法监听 ${HOST}：该地址不属于本机网卡`);
  } else {
    console.error("[nutrition] 服务器错误：" + err.message);
  }
  process.exit(1);
});

function lanAddresses() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        const family = net.family === "IPv4" || net.family === 4;
        if (family && !net.internal) out.push(net.address);
      }
    }
  } catch {}
  return out;
}

server.listen(PORT, HOST, () => {
  const isWildcard = IS_WILDCARD_HOST;
  const shownHost = isWildcard ? "127.0.0.1" : HOST;
  console.log(`[nutrition] v${VERSION} 已启动：http://${shownHost}:${PORT}`);
  console.log(`[nutrition] HOST=${HOST} PORT=${PORT} text=${TEXT_MODEL} vision=${VISION_MODEL} rpm=${RPM}`);
  console.log(`[nutrition] 限流：${RATE_LIMIT > 0
    ? `每个客户端 IP 每 ${RATE_WINDOW_MIN} 分钟最多 ${RATE_LIMIT} 次（TRUST_PROXY=${TRUST_PROXY ? "开" : "关"}，/api/health 不计入）`
    : "已关闭（API_RATE_LIMIT=0）"}`);
  console.log(`[nutrition] 上游：${BASE_URL.protocol}//${BASE_URL.host}${UPSTREAM_PATH}（${TRANSPORT === https ? "https" : "http"}）`);

  if (isWildcard) {
    const lan = lanAddresses();
    console.warn("[nutrition] ⚠ 当前 HOST=" + HOST + "，服务会监听所有网卡：局域网内任何设备都可访问。");
    if (lan.length) console.warn("[nutrition] ⚠ 局域网访问地址：" + lan.map((ip) => `http://${ip}:${PORT}`).join("  "));
    console.warn("[nutrition] ⚠ 公网暴露风险：所有访客都会消耗你的 Kimi 账号配额，请务必加反向代理 + HTTPS + 收紧限流，并设置 API_RATE_LIMIT。");
    console.warn("[nutrition] ⚠ 若只想本机使用，请设置 HOST=127.0.0.1（默认值）后重启。");
  }

  if (!API_KEY) {
    console.warn("[nutrition] 警告：未配置 KIMI_API_KEY，AI 接口将返回 503（本地记录/查询等功能不受影响）");
  }

  // 账号体系状态：SMTP 未配齐时无法发验证码；DB 不可用时 AI 与 auth 均返回 503
  if (AUTH_ENABLED) {
    console.log(`[auth] 邮箱验证码登录已启用：SMTP ${SMTP_HOST}:${SMTP_PORT}（TLS）、发件人 ${maskEmail(MAIL_FROM)}、额度 ${AI_QUOTA_PER_DAY} 次/会话/天`);
  } else {
    console.warn("[auth] ⚠ 未配置 SMTP_HOST/SMTP_USER/SMTP_PASS：无法发送验证码，AI 功能将对所有人返回 401 LOGIN_REQUIRED");
  }
  if (!db) console.warn("[auth] ⚠ SQLite 存储不可用，auth 与 AI 接口将返回 503");
  if (AUTH_DEV_LOG_CODE) console.warn("[auth] ⚠ AUTH_DEV_LOG_CODE=1：验证码会打印到服务端日志，仅限本地调试，生产务必关闭");
});

/* ---------- 优雅关闭 ---------- */
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[nutrition] 收到 ${signal}，正在停止接收新连接…`);
  clearInterval(ratePruneTimer);
  clearInterval(purgeTimer);
  let exitTimer = setTimeout(() => {
    console.warn("[nutrition] 仍有连接未关闭，强制退出");
    try { server.closeAllConnections(); } catch {}
    process.exit(0);
  }, 8000);
  if (typeof exitTimer.unref === "function") exitTimer.unref();

  server.close(() => {
    clearTimeout(exitTimer);
    try { if (db) db.close(); } catch {}
    console.log("[nutrition] 已安全关闭");
    process.exit(0);
  });
  // Node >= 18.2：主动关闭空闲的 keep-alive 连接，加快退出
  try {
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  } catch {}
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
