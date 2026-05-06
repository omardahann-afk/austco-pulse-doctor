import { spawn } from "node:child_process";
import { once } from "node:events";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const DEFAULT_MONITOR_BACKEND_URL = "http://127.0.0.1:3001";
const START_TIMEOUT_MS = 8000;

let backendReadyPromise: Promise<void> | null = null;
let backendProcess: ReturnType<typeof spawn> | null = null;

function getMonitorBackendUrl() {
  return (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || DEFAULT_MONITOR_BACKEND_URL).replace(/\/$/, "");
}

function isReadyError(error: unknown) {
  return error instanceof Error && /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(error.message);
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

async function waitForBackendReady() {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    try {
      await fetchJson("/api/health");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Monitor backend did not become ready in time");
}

async function startBackendProcess() {
  if (backendProcess && backendProcess.exitCode == null && !backendProcess.killed) return;

  const child = spawn("node", ["server/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: process.env.PORT_3001 || "3001", BIND_HOST: "127.0.0.1" },
    stdio: "ignore",
  });

  backendProcess = child;
  child.once("exit", () => {
    if (backendProcess === child) backendProcess = null;
  });

  await Promise.race([
    waitForBackendReady(),
    (async () => {
      const [code, signal] = await once(child, "exit");
      throw new Error(`Monitor backend exited before ready (${code ?? "null"}${signal ? `, ${signal}` : ""})`);
    })(),
  ]);
}

export async function ensureMonitorBackendReady() {
  if (backendReadyPromise) return backendReadyPromise;

  backendReadyPromise = (async () => {
    try {
      await fetchJson("/api/health");
      return;
    } catch (error) {
      if (!isReadyError(error)) throw error;
    }

    await startBackendProcess();
  })().finally(() => {
    backendReadyPromise = null;
  });

  return backendReadyPromise;
}

export async function getMonitorRegistry() {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean; devices: JsonValue[] }>("/api/monitor/devices");
}

export async function saveMonitorDevice(body: JsonValue) {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean; device?: JsonValue; reason?: string; errors?: string[] }>("/api/monitor/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteMonitorDevice(id: string) {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean; deleted: number }>(`/api/monitor/devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getMonitorState() {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean; devices: JsonValue[] }>("/api/monitor/state");
}

export async function getMonitorStatus() {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/status");
}

export async function startMonitorScheduler() {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function stopMonitorScheduler() {
  await ensureMonitorBackendReady();
  return fetchJson<{ ok: boolean } & Record<string, JsonValue>>("/api/monitor/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function getMonitorProxyWsUrl() {
  return "/ws/monitor";
}