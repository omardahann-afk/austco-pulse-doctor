/**
 * Live monitor WebSocket bus hook.
 *
 * Connects to ws://<agent>/ws/monitor, applies probe_result / state_change
 * events to a local map of DeviceStateRow. Auto-reconnects with exponential
 * backoff. Surfaces a clear connection state for the UI.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeviceStateRow, type Evidence, type SchedulerStatus,
  getMonitorWsUrl, monitorApi,
} from "@/lib/monitorClient";
import { useSiteConfigStore } from "@/stores/siteConfigStore";

export type MonitorConn = "connecting" | "open" | "closed" | "offline";

type BusEvent =
  | { type: "hello"; time: string; scheduler: SchedulerStatus; snapshot: DeviceStateRow[] }
  | { type: "snapshot"; scheduler: SchedulerStatus; snapshot: DeviceStateRow[] }
  | { type: "probe_result"; deviceId: string; evidence: Evidence; state: { state: string; last_ok_ts: string | null; last_check_ts: string | null; consecutive_fail: number; consecutive_ok: number; latency_ms_avg: number | null; packet_loss_pct: number | null; last_error: string | null } }
  | { type: "state_change"; deviceId: string; from: string | null; to: string; evidence: Evidence }
  | { type: "pong"; time: string };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export function useMonitorBus() {
  const monitoredDevices = useSiteConfigStore((state) => state.monitoredDevices);
  const [conn, setConn] = useState<MonitorConn>("connecting");
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [devices, setDevices] = useState<Map<string, DeviceStateRow>>(new Map());
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [recentProbes, setRecentProbes] = useState<{ deviceId: string; evidence: Evidence }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const stopped = useRef(false);

  const mergeRegistryRows = useCallback((rows: DeviceStateRow[]) => {
    const stateRows = new Map(rows.map((row) => [row.id, row]));
    for (const device of monitoredDevices) {
      if (!stateRows.has(device.id)) {
        stateRows.set(device.id, {
          id: device.id,
          name: device.name,
          kind: device.kind,
          protocol: device.protocol,
          host: device.host,
          port: device.port,
          url: device.url,
          enabled: device.enabled ? 1 : 0,
          interval_ms: device.intervalMs,
          state: "unknown",
          last_ok_ts: null,
          last_check_ts: null,
          consecutive_fail: 0,
          consecutive_ok: 0,
          backoff_ms: 0,
          latency_ms_avg: null,
          packet_loss_pct: null,
          last_error: null,
        });
      }
    }
    return Array.from(stateRows.values());
  }, [monitoredDevices]);

  const applySnapshot = useCallback((rows: DeviceStateRow[]) => {
    setDevices(new Map(mergeRegistryRows(rows).map((r) => [r.id, r])));
  }, [mergeRegistryRows]);

  const refreshHttp = useCallback(async () => {
    // HTTP fallback — also used as the initial fetch before WS hello arrives.
    try {
      const [s, st] = await Promise.all([monitorApi.state(), monitorApi.status()]);
      if (s.ok) {
        applySnapshot(s.devices);
      }
      if (st.ok) setScheduler({ running: st.running, startedAt: st.startedAt, scheduledDevices: st.scheduledDevices, inFlight: st.inFlight, options: st.options });
    } catch { /* offline — UI shows offline badge */ }
  }, [applySnapshot]);

  const connect = useCallback(() => {
    if (stopped.current) return;
    setConn("connecting");
    let url: string;
    try { url = getMonitorWsUrl(); }
    catch { setConn("offline"); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch { scheduleReconnect(); return; }
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setConn("open");
    };
    ws.onmessage = (ev) => {
      let msg: BusEvent;
      try { msg = JSON.parse(ev.data) as BusEvent; } catch { return; }
      setLastEventAt(new Date().toISOString());
      if (msg.type === "hello" || msg.type === "snapshot") {
        applySnapshot(msg.snapshot);
        setScheduler(msg.scheduler);
      } else if (msg.type === "probe_result") {
        setDevices((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.deviceId);
          if (!existing) return next;
          next.set(msg.deviceId, {
            ...existing,
            state: (msg.state.state as DeviceStateRow["state"]) ?? existing.state,
            last_ok_ts: msg.state.last_ok_ts ?? existing.last_ok_ts,
            last_check_ts: msg.state.last_check_ts ?? existing.last_check_ts,
            consecutive_fail: msg.state.consecutive_fail,
            consecutive_ok: msg.state.consecutive_ok,
            latency_ms_avg: msg.state.latency_ms_avg,
            packet_loss_pct: msg.state.packet_loss_pct,
            last_error: msg.state.last_error,
          });
          return next;
        });
        setRecentProbes((prev) => [{ deviceId: msg.deviceId, evidence: msg.evidence }, ...prev].slice(0, 50));
      } else if (msg.type === "state_change") {
        // probe_result will follow with details; this is a dedicated transition signal.
        setDevices((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.deviceId);
          if (!existing) return next;
          next.set(msg.deviceId, { ...existing, state: msg.to as DeviceStateRow["state"] });
          return next;
        });
      }
    };
    ws.onclose = () => { setConn("closed"); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySnapshot]);

  const scheduleReconnect = useCallback(() => {
    if (stopped.current) return;
    if (reconnectTimer.current != null) return;
    const attempt = ++retryRef.current;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt - 1, 4)));
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      // refresh via HTTP while reconnecting so the UI doesn't go stale
      refreshHttp();
      connect();
    }, delay);
  }, [connect, refreshHttp]);

  useEffect(() => {
    stopped.current = false;
    refreshHttp();
    connect();
    return () => {
      stopped.current = true;
      if (reconnectTimer.current != null) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [connect, refreshHttp]);

  useEffect(() => {
    setDevices((prev) => new Map(mergeRegistryRows(Array.from(prev.values())).map((row) => [row.id, row])));
  }, [mergeRegistryRows]);

  const requestSnapshot = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type: "snapshot" })); } catch { /* ignore */ }
    } else {
      refreshHttp();
    }
  }, [refreshHttp]);

  return {
    conn,
    scheduler,
    devices: Array.from(devices.values()),
    devicesById: devices,
    lastEventAt,
    recentProbes,
    requestSnapshot,
    refreshHttp,
  };
}