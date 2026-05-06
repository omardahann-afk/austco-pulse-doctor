/**
 * Live Monitor API client + types.
 *
 * Talks to the local Tacera Doctor agent (default http://localhost:3001).
 * Pure HTTP — the WebSocket live stream is in `useMonitorBus.ts`.
 */
import { getBackendUrl } from "./siteConfig";

export type ProbeProtocol = "icmp" | "tcp" | "http" | "https" | "mqtt";
export type DeviceState = "up" | "degraded" | "down" | "stale" | "unknown";

export type MonitorDevice = {
  id: string;
  name: string | null;
  kind: string;
  protocol: ProbeProtocol;
  host: string | null;
  port: number | null;
  url: string | null;
  tls: boolean;
  intervalMs: number;
  enabled: boolean;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DeviceStateRow = {
  id: string;
  name: string | null;
  kind: string;
  protocol: ProbeProtocol;
  host: string | null;
  port: number | null;
  url: string | null;
  enabled: 0 | 1;
  interval_ms: number;
  state: DeviceState | null;
  last_ok_ts: string | null;
  last_check_ts: string | null;
  consecutive_fail: number | null;
  consecutive_ok: number | null;
  backoff_ms: number | null;
  latency_ms_avg: number | null;
  packet_loss_pct: number | null;
  last_error: string | null;
};

export type Evidence = {
  source: string;
  timestamp: string;
  protocol: string;
  device: { id: string | null; name: string | null; host: string | null; port: number | null };
  ok: boolean;
  latencyMs: number | null;
  raw: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
};

export type HistoryEntry = {
  ts: string;
  protocol: string;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  durationMs: number;
  raw: Record<string, unknown>;
  source: string | null;
};

export type Trend = {
  samples: number;
  successRate?: number;
  failureCount?: number;
  latencyMsAvg?: number | null;
  latencyMsMin?: number | null;
  latencyMsMax?: number | null;
  packetLossPctAvg?: number | null;
};

export type SchedulerStatus = {
  running: boolean;
  startedAt: string | null;
  scheduledDevices: number;
  inFlight: number;
  options: Record<string, unknown>;
};

function base(): string { return getBackendUrl().replace(/\/$/, ""); }

async function get<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base() + path, { ...init, signal: ctrl.signal });
    const json = await res.json();
    return json as T;
  } finally { clearTimeout(t); }
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const monitorApi = {
  info:    () => get<{ ok: boolean; db: { path: string | null; openedAt: string | null }; scheduler: SchedulerStatus; supportedProtocols: ProbeProtocol[] }>("/api/monitor/info"),
  status:  () => get<{ ok: boolean } & SchedulerStatus>("/api/monitor/status"),
  start:   () => get<{ ok: boolean; startedAt?: string; devices?: number; alreadyRunning?: boolean }>("/api/monitor/start", jsonBody({})),
  stop:    () => get<{ ok: boolean; stoppedAt?: string }>("/api/monitor/stop", jsonBody({})),
  state:   () => get<{ ok: boolean; devices: DeviceStateRow[] }>("/api/monitor/state"),
  devices: () => get<{ ok: boolean; devices: MonitorDevice[] }>("/api/monitor/devices"),
  upsertDevice: (d: Partial<MonitorDevice> & { id: string; protocol: ProbeProtocol; kind: string }) =>
    get<{ ok: boolean; device?: MonitorDevice; reason?: string; errors?: string[] }>("/api/monitor/devices", jsonBody(d)),
  deleteDevice: (id: string) =>
    get<{ ok: boolean; deleted: number }>(`/api/monitor/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  history: (id: string, limit = 200) =>
    get<{ ok: boolean; device?: MonitorDevice; history: HistoryEntry[]; trend: Trend }>(`/api/monitor/history/${encodeURIComponent(id)}?limit=${limit}`),
  probeNow: (id: string) =>
    get<{ ok: boolean; evidence?: Evidence; reason?: string }>(`/api/monitor/probe-now/${encodeURIComponent(id)}`, jsonBody({})),
  probeAdhoc: (device: Partial<MonitorDevice> & { protocol: ProbeProtocol; kind?: string }) =>
    get<{ ok: boolean; evidence?: Evidence; reason?: string; errors?: string[] }>(
      "/api/monitor/probe", jsonBody({ id: device.id ?? "adhoc", kind: device.kind ?? "generic", ...device }),
      15000,
    ),
};

/** Convert agent http(s) url to ws(s) for the monitor bus. */
export function getMonitorWsUrl(): string {
  const b = base();
  return b.replace(/^http/i, "ws") + "/ws/monitor";
}

export function stateColor(s: DeviceState | null | undefined): string {
  switch (s) {
    case "up":       return "bg-emerald-500";
    case "degraded": return "bg-amber-500";
    case "down":     return "bg-red-500";
    case "stale":    return "bg-slate-500";
    default:         return "bg-muted-foreground/40";
  }
}

export function stateLabel(s: DeviceState | null | undefined): string {
  return (s ?? "unknown").toUpperCase();
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return "—";
  const ms = Date.now() - d;
  if (ms < 1500) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}