type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: { code: string; message: string } };

const API_LOG_BUILD = "2026-11-07.02";
/**
 * 控制台日志级别（只影响"请求/返回"这类流水日志，失败/异常日志始终打印）：
 * - 默认 off：前端调后台自己的接口不打印，控制台只保留真实错误。
 * - localStorage["xuan.api.logAll"]="mutate"：打印写操作（POST/PUT/PATCH/DELETE）。
 * - localStorage["xuan.api.logAll"]="1"：打印全部请求（含 GET 查询）。
 * 想看「后台 → 游戏服」的调用，去后台「系统管理 → 游戏接口日志」页面。
 */
type ApiLogMode = "off" | "mutate" | "all";
const API_LOG_MODE: ApiLogMode = (() => {
  try {
    const raw = localStorage.getItem("xuan.api.logAll");
    if (raw === "1" || raw === "all") return "all";
    if (raw === "mutate") return "mutate";
    return "off";
  } catch {
    return "off";
  }
})();
const API_LOG_MODE_LABEL: Record<ApiLogMode, string> = {
  off: "仅打印失败日志",
  mutate: "仅记录写操作",
  all: "记录全部请求",
};
function shouldLogCall(method: string): boolean {
  if (API_LOG_MODE === "off") return false;
  if (API_LOG_MODE === "all") return true;
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}
console.info(`[XuanManager API] 日志已启用 build=${API_LOG_BUILD}（${API_LOG_MODE_LABEL[API_LOG_MODE]}）`);

export const SESSION_EXPIRED_EVENT = "xuan:session-expired";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "REQUEST_FAILED", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function csrfToken(): string {
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("xuan_csrf="));
  return value ? decodeURIComponent(value.slice("xuan_csrf=".length)) : "";
}

/** 只用于控制台排查：密码/令牌等字段必须脱敏，不能原样打印。 */
function debugBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (/pass(word)?|token|secret|authorization/i.test(key)) return [key, "***"];
        return [key, redact(item)];
      }));
    };
    return redact(parsed);
  } catch {
    return body.length > 300 ? `${body.slice(0, 300)}…` : body;
  }
}

function logApiError(message: string, detail: Record<string, unknown>): void {
  // F12 控制台统一用 [XuanManager API] 前缀，方便直接筛选。
  console.error(`[XuanManager API] ${message}`, detail);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken());
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const requestPath = path.startsWith("/api/") ? `${base}${path}` : path;
  if (shouldLogCall(method)) {
    console.log(`[XuanManager API] 请求 ${method} ${requestPath}`, {
      method,
      path: requestPath,
      request: debugBody(init.body),
    });
  }
  let response: Response;
  try {
    response = await fetch(requestPath, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: init.cache ?? (method === "GET" ? "no-store" : undefined),
    });
  } catch (reason) {
    logApiError(`网络失败 ${method} ${requestPath}`, {
      method,
      path: requestPath,
      request: debugBody(init.body),
      error: reason,
    });
    throw new ApiError(reason instanceof Error ? reason.message : "网络请求失败", "NETWORK_ERROR", 0);
  }

  const rawResponse = response.clone();
  let payload: ApiSuccess<T> | ApiFailure;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    let rawText = "";
    try {
      rawText = await rawResponse.text();
    } catch {
      // 读取原始报文失败时不再抛错，保留 status 供排查。
    }
    logApiError(`非 JSON ${method} ${requestPath} HTTP ${response.status}`, {
      method,
      path: requestPath,
      status: response.status,
      request: debugBody(init.body),
      body: rawText.slice(0, 1000),
    });
    throw new ApiError("服务器返回了无法识别的内容", "BAD_RESPONSE", response.status);
  }
  if (!response.ok || !payload.ok) {
    const failure = payload as ApiFailure;
    logApiError(
      `失败 ${method} ${requestPath} HTTP ${response.status} code=${failure.error?.code || "?"} message=${failure.error?.message || "?"}`,
      {
        method,
        path: requestPath,
        status: response.status,
        code: failure.error?.code,
        message: failure.error?.message,
        request: debugBody(init.body),
        response: payload,
      },
    );
    if (response.status === 401 && failure.error?.code === "UNAUTHORIZED") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(failure.error?.message || "请求失败", failure.error?.code, response.status);
  }
  if (shouldLogCall(method)) {
    console.log(`[XuanManager API] 返回 ${method} ${requestPath} HTTP ${response.status}`, {
      method,
      path: requestPath,
      status: response.status,
      data: payload.data,
    });
  }
  return payload.data;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
