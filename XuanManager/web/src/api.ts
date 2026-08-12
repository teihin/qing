type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: { code: string; message: string } };

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
  const response = await fetch(requestPath, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: init.cache ?? (method === "GET" ? "no-store" : undefined),
  });
  let payload: ApiSuccess<T> | ApiFailure;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    throw new ApiError("服务器返回了无法识别的内容", "BAD_RESPONSE", response.status);
  }
  if (!response.ok || !payload.ok) {
    const failure = payload as ApiFailure;
    if (response.status === 401 && failure.error?.code === "UNAUTHORIZED") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(failure.error?.message || "请求失败", failure.error?.code, response.status);
  }
  return payload.data;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
