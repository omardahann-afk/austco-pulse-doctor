type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const DEFAULT_MONITOR_BACKEND_URL = "http://127.0.0.1:3001";

function getMonitorBackendUrl() {
  return (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || DEFAULT_MONITOR_BACKEND_URL).replace(/\/$/, "");
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getMonitorBackendUrl()}${path}`, init);
  const payload = (await response.json()) as T;
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "message" in payload
      ? String((payload as Record<string, unknown>).message)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function getMonitorRegistry() {
  return fetchJson<{ ok: boolean; devices: JsonValue[] }>("/api/monitor/devices");
}

export async function saveMonitorDevice(body: JsonValue) {
  return fetchJson<{ ok: boolean; device?: JsonValue; reason?: string; errors?: string[] }>("/api/monitor/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteMonitorDevice(id: string) {
  return fetchJson<{ ok: boolean; deleted: number }>(`/api/monitor/devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getMonitorState() {
  return fetchJson<{ ok: boolean; devices: JsonValue[] }>("/api/monitor/state");
}

export async function getMonitorStatus() {
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/status");
}

export async function startMonitorScheduler() {
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function stopMonitorScheduler() {
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function getMonitorProxyWsUrl() {
  return "/ws/monitor";
}