/**
 * WebSocket bus for live agent → UI push.
 *
 * Endpoint: ws://<agent>/ws/monitor
 *
 * On connect, the client receives:
 *   { type: "hello", time, scheduler, snapshot }
 * Then, for each scheduler event:
 *   { type: "probe_result", deviceId, evidence, state }
 *   { type: "state_change", deviceId, from, to, evidence }
 *
 * The bus pings every 25s and drops dead sockets. No auth here — intended
 * for a trusted local agent. If you bind on 0.0.0.0, run behind a firewall.
 */
import { WebSocketServer } from "ws";
import { schedulerStatus, subscribe } from "./pollingScheduler.js";
import { listDeviceStates } from "./healthDb.js";

let wss = null;
let unsubscribe = null;
const PING_INTERVAL_MS = 25_000;

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* drop */ }
}

export function attachWsBus(httpServer, { path = "/ws/monitor" } = {}) {
  if (wss) return wss;
  wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    safeSend(ws, {
      type: "hello",
      time: new Date().toISOString(),
      scheduler: schedulerStatus(),
      snapshot: listDeviceStates(),
    });
    ws.on("message", (raw) => {
      // Client may send {type:"snapshot"} to force a refresh.
      let msg; try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
      if (msg?.type === "snapshot") {
        safeSend(ws, { type: "snapshot", scheduler: schedulerStatus(), snapshot: listDeviceStates() });
      } else if (msg?.type === "ping") {
        safeSend(ws, { type: "pong", time: new Date().toISOString() });
      }
    });
  });

  // Liveness heartbeat
  const interval = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, PING_INTERVAL_MS);
  if (typeof interval.unref === "function") interval.unref();

  // Bridge scheduler events to all clients.
  unsubscribe = subscribe((event) => {
    if (!wss) return;
    for (const ws of wss.clients) safeSend(ws, event);
  });

  return wss;
}

export function detachWsBus() {
  if (unsubscribe) { try { unsubscribe(); } catch {} unsubscribe = null; }
  if (wss) { try { wss.close(); } catch {} wss = null; }
}

export function wsClientCount() {
  return wss ? wss.clients.size : 0;
}