/**
 * render-backend 安全与并发控制辅助模块
 * 提供 CORS 来源校验、API 写入字段白名单、WebSocket 地址校验及任务/账号互斥锁。
 */

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
const SAFE_RECORD_ID_RE = /^[\w-]{1,64}$/;

export function parseAllowedOrigins(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin, allowedOriginsRaw) {
  if (!origin) return true;
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;

  const configured = parseAllowedOrigins(allowedOriginsRaw);
  if (configured.includes("*")) return true;
  return configured.includes(origin);
}

export function createCorsOptions(getAllowedOrigins) {
  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin, getAllowedOrigins?.())) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    maxAge: 86400,
  };
}

export function isValidRecordId(id) {
  return typeof id === "string" && SAFE_RECORD_ID_RE.test(id);
}

export function sanitizeTokenInsert(body, validateWsUrl) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("请求体必须是 JSON 对象");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) {
    throw new Error("角色名称必须在 1-64 个字符之间");
  }

  if (
    body.token === undefined ||
    body.token === null ||
    body.token === "" ||
    (typeof body.token !== "string" && typeof body.token !== "object")
  ) {
    throw new Error("缺少有效的 token 字段");
  }
  if (typeof body.token === "string" && body.token.length > 16384) {
    throw new Error("token 长度超出限制");
  }

  const payload = { name, token: body.token };

  if (body.ws_url !== undefined) {
    payload.ws_url =
      body.ws_url === null || body.ws_url === ""
        ? null
        : validateWsUrl(body.ws_url);
  }
  if (
    body.roleId !== undefined &&
    (typeof body.roleId === "string" || typeof body.roleId === "number")
  ) {
    payload.roleId = body.roleId;
  }
  if (
    body.sessId !== undefined &&
    (typeof body.sessId === "string" || typeof body.sessId === "number")
  ) {
    payload.sessId = body.sessId;
  }
  if (
    body.connId !== undefined &&
    (typeof body.connId === "string" || typeof body.connId === "number")
  ) {
    payload.connId = body.connId;
  }
  if (
    body.isRestore !== undefined &&
    (typeof body.isRestore === "number" || typeof body.isRestore === "boolean")
  ) {
    payload.isRestore = body.isRestore;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw new TypeError("enabled 必须是布尔值");
    }
    payload.enabled = body.enabled;
  }

  return payload;
}

function parseArrayOrJson(value, fieldName) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  throw new Error(`${fieldName} 必须是数组`);
}

export function sanitizeTaskPayload(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("请求体必须是 JSON 对象");
  }

  const {
    partial = false,
    validTaskKeys = [],
    validateCron = () => true,
  } = options;
  const validKeySet = new Set(validTaskKeys);
  const payload = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      throw new Error("任务名称必须在 1-100 个字符之间");
    }
    payload.name = name;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw new TypeError("enabled 必须是布尔值");
    }
    payload.enabled = body.enabled;
  }

  const cronExpr = body.cron_expr ?? body.cron_expression;
  if (cronExpr !== undefined) {
    if (typeof cronExpr !== "string" || !validateCron(cronExpr.trim())) {
      throw new Error("无效的 Cron 表达式");
    }
    if (body.cron_expr !== undefined) payload.cron_expr = cronExpr.trim();
    if (body.cron_expression !== undefined) {
      payload.cron_expression = cronExpr.trim();
    }
  } else if (!partial) {
    throw new Error("缺少 Cron 表达式");
  }

  if (body.selected_tokens !== undefined) {
    const tokens = parseArrayOrJson(body.selected_tokens, "selected_tokens");
    if (!partial && tokens.length === 0) {
      throw new Error("selected_tokens 不能为空");
    }
    payload.selected_tokens = Array.isArray(body.selected_tokens)
      ? tokens
      : JSON.stringify(tokens);
  }
  if (body.token_ids !== undefined) {
    const tokens = parseArrayOrJson(body.token_ids, "token_ids");
    if (!partial && tokens.length === 0) {
      throw new Error("token_ids 不能为空");
    }
    payload.token_ids = Array.isArray(body.token_ids)
      ? tokens
      : JSON.stringify(tokens);
  }
  if (!partial && !payload.selected_tokens && !payload.token_ids) {
    throw new Error("必须提供至少一个目标角色");
  }

  if (body.selected_tasks !== undefined) {
    const tasks = parseArrayOrJson(body.selected_tasks, "selected_tasks");
    if (tasks.length === 0) {
      throw new Error("selected_tasks 不能为空");
    }
    for (const key of tasks) {
      if (!validKeySet.has(key)) {
        throw new Error(`未知任务类型: ${String(key)}`);
      }
    }
    payload.selected_tasks = Array.isArray(body.selected_tasks)
      ? tasks
      : JSON.stringify(tasks);
  }
  if (body.task_type !== undefined) {
    if (
      typeof body.task_type !== "string" ||
      !validKeySet.has(body.task_type)
    ) {
      throw new Error(`未知任务类型: ${String(body.task_type)}`);
    }
    payload.task_type = body.task_type;
  }
  if (!partial && !payload.selected_tasks && !payload.task_type) {
    throw new Error("必须选择至少一个任务类型");
  }

  if (partial && Object.keys(payload).length === 0) {
    throw new Error("没有可更新的有效字段");
  }

  return payload;
}

export class ExecutionMutex {
  constructor() {
    this.activeTaskIds = new Set();
    this.tokenChains = new Map();
  }

  isTaskRunning(taskId) {
    return this.activeTaskIds.has(String(taskId));
  }

  async runTaskExclusive(taskId, fn) {
    const key = String(taskId);
    if (this.activeTaskIds.has(key)) {
      return { skipped: true, reason: "already_running" };
    }
    this.activeTaskIds.add(key);
    try {
      const value = await fn();
      return { skipped: false, value };
    } finally {
      this.activeTaskIds.delete(key);
    }
  }

  withTokenLock(tokenId, fn) {
    const key = String(tokenId);
    const previous = this.tokenChains.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => fn());
    const cleanup = current.finally(() => {
      if (this.tokenChains.get(key) === cleanup) {
        this.tokenChains.delete(key);
      }
    });
    this.tokenChains.set(key, cleanup);
    return current;
  }
}
