/**
 * Live Polling Engine.
 *
 * Per-device timer that runs the appropriate probe (icmp/tcp/https/mqtt),
 * stores the evidence record in SQLite, and updates device_state with:
 *   - state transitions: up | degraded | down | stale | unknown
 *   - consecutive ok / fail streaks
 *   - exponential backoff for failing devices (reconnect engine)
 *   - stale detection (no successful poll within N intervals)
 *
 * The scheduler is in-process and survives restarts only via SQLite history.
 * On start(), it rebuilds the schedule from the devices table.
 *
 * No fake data. If the agent cannot reach a device, the result is recorded
 * as a real failure with the protocol-specific error string.
 */
import {
  listDevices, getDevice, upsertDeviceState, getDeviceState,
  recordProbeResult, getDeviceTrend,
} from "./healthDb.js";
import { icmpProbe } from "./probes/icmpProbe.js";
import { tcpProbe } from "./probes/tcpProbe.js";
import { httpsProbe } from "./probes/httpsProbe.js";
import { mqttConnectProbe } from "./probes/mqttConnectProbe.js";

const PROBES = {
  icmp: icmpProbe,
  tcp: tcpProbe,
  http: httpsProbe,
  https: httpsProbe,
  mqtt: mqttConnectProbe,
};

/** Tunables for state machine. */
const DEFAULTS = {
  degradedAfterFails: 1,   // 1 fail -> degraded
  downAfterFails: 3,       // 3 consecutive fails -> down
  staleMultiplier: 3,      // no successful poll for 3 intervals -> stale
  backoffStartMs: 5_000,
  backoffMaxMs: 5 * 60_000,
  jitterPct: 0.1,
};

const timers = new Map();        // deviceId -> Timeout
const inFlight = new Set();      // deviceId currently being probed
let running = false;
let startedAt = null;
let opts = { ...DEFAULTS };
let listeners = new Set();       // subscriber callbacks (state changes)

function jitter(ms) {
  const j = ms * opts.jitterPct;
  return Math.max(500, Math.round(ms + (Math.random() * 2 - 1) * j));
}

function nextDelayMs(device, state) {
  const baseline = jitter(device.intervalMs || 30_000);
  if (!state || state.consecutive_fail === 0) return baseline;
  // Exponential backoff while failing, capped, but never longer than baseline*4.
  const backoff = Math.min(opts.backoffMaxMs, opts.backoffStartMs * Math.pow(2, state.consecutive_fail - 1));
  return jitter(Math.min(Math.max(baseline, backoff), baseline * 4));
}

function classify(device, evidence, prevState) {
  const now = evidence.timestamp;
  let consecutive_fail = prevState?.consecutive_fail || 0;
  let consecutive_ok = prevState?.consecutive_ok || 0;
  let last_ok_ts = prevState?.last_ok_ts || null;

  if (evidence.ok) {
    consecutive_ok += 1;
    consecutive_fail = 0;
    last_ok_ts = now;
  } else {
    consecutive_fail += 1;
    consecutive_ok = 0;
  }

  let state = "unknown";
  if (evidence.ok) {
    state = "up";
  } else if (consecutive_fail >= opts.downAfterFails) {
    state = "down";
  } else {
    state = "degraded";
  }
  return { state, consecutive_fail, consecutive_ok, last_ok_ts };
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch { /* listener should not break scheduler */ }
  }
}

async function runOnce(deviceId) {
  if (inFlight.has(deviceId)) return;
  const device = getDevice(deviceId);
  if (!device || !device.enabled) {
    timers.delete(deviceId);
    return;
  }
  const probe = PROBES[device.protocol];
  if (!probe) {
    // Unknown protocol — record as failure once, then stop scheduling.
    upsertDeviceState(deviceId, {
      state: "unknown", last_check_ts: new Date().toISOString(),
      last_error: `unsupported_protocol:${device.protocol}`,
    });
    return;
  }

  inFlight.add(deviceId);
  let evidence;
  try {
    evidence = await probe(device);
  } catch (err) {
    // Probe primitives should never throw, but be defensive.
    evidence = {
      source: "scheduler", timestamp: new Date().toISOString(),
      protocol: device.protocol,
      device: { id: device.id, name: device.name, host: device.host, port: device.port },
      ok: false, latencyMs: null, raw: null, error: err?.message || String(err), durationMs: 0,
    };
  } finally {
    inFlight.delete(deviceId);
  }

  recordProbeResult(deviceId, evidence);
  const prev = getDeviceState(deviceId);
  const cls = classify(device, evidence, prev);

  // Compute trend snapshot (cheap — last 50 records).
  const trend = getDeviceTrend(deviceId, { limit: 50 });

  const newState = upsertDeviceState(deviceId, {
    state: cls.state,
    last_ok_ts: cls.last_ok_ts,
    last_check_ts: evidence.timestamp,
    consecutive_fail: cls.consecutive_fail,
    consecutive_ok: cls.consecutive_ok,
    backoff_ms: cls.consecutive_fail ? Math.min(opts.backoffMaxMs, opts.backoffStartMs * Math.pow(2, cls.consecutive_fail - 1)) : 0,
    latency_ms_avg: trend?.latencyMsAvg ?? null,
    packet_loss_pct: trend?.packetLossPctAvg ?? null,
    last_error: evidence.error || null,
  });

  if (!prev || prev.state !== cls.state) {
    emit({ type: "state_change", deviceId, from: prev?.state || null, to: cls.state, evidence });
  }
  emit({ type: "probe_result", deviceId, evidence, state: newState });

  // Schedule next run with backoff/jitter.
  scheduleNext(deviceId, nextDelayMs(device, newState));
}

function scheduleNext(deviceId, delayMs) {
  if (!running) return;
  const existing = timers.get(deviceId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => runOnce(deviceId).catch(() => {}), delayMs);
  // Don't keep the event loop alive just for this timer; the express server does that.
  if (typeof t.unref === "function") t.unref();
  timers.set(deviceId, t);
}

/* ---------- Public API ---------- */

export function startScheduler(userOpts = {}) {
  if (running) return { ok: true, alreadyRunning: true, startedAt };
  opts = { ...DEFAULTS, ...userOpts };
  running = true;
  startedAt = new Date().toISOString();
  for (const d of listDevices({ enabledOnly: true })) {
    // First run staggered: random delay up to interval to avoid thundering herd.
    const initial = Math.floor(Math.random() * Math.min(d.intervalMs, 10_000));
    scheduleNext(d.id, initial);
  }
  return { ok: true, startedAt, devices: timers.size };
}

export function stopScheduler() {
  running = false;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  inFlight.clear();
  const stoppedAt = new Date().toISOString();
  const wasStartedAt = startedAt;
  startedAt = null;
  return { ok: true, stoppedAt, startedAt: wasStartedAt };
}

export function schedulerStatus() {
  return {
    running,
    startedAt,
    scheduledDevices: timers.size,
    inFlight: inFlight.size,
    options: { ...opts },
  };
}

/** Probe a single device on demand (does not affect schedule). */
export async function probeDeviceNow(deviceId) {
  const device = getDevice(deviceId);
  if (!device) return { ok: false, reason: "device_not_found" };
  const probe = PROBES[device.protocol];
  if (!probe) return { ok: false, reason: "unsupported_protocol", protocol: device.protocol };
  const evidence = await probe(device);
  recordProbeResult(deviceId, evidence);
  const prev = getDeviceState(deviceId);
  const cls = classify(device, evidence, prev);
  upsertDeviceState(deviceId, {
    state: cls.state, last_ok_ts: cls.last_ok_ts, last_check_ts: evidence.timestamp,
    consecutive_fail: cls.consecutive_fail, consecutive_ok: cls.consecutive_ok,
    last_error: evidence.error || null,
  });
  return { ok: true, evidence };
}

/** Re-evaluate stale devices without polling. Marks devices stale=true if no
 *  successful poll for staleMultiplier * intervalMs. */
export function sweepStale() {
  const now = Date.now();
  const updated = [];
  for (const d of listDevices()) {
    const s = getDeviceState(d.id);
    if (!s) continue;
    const lastOkMs = s.last_ok_ts ? Date.parse(s.last_ok_ts) : 0;
    const ageMs = now - lastOkMs;
    const staleAfter = (d.intervalMs || 30_000) * opts.staleMultiplier;
    if (s.state !== "stale" && lastOkMs && ageMs > staleAfter && s.state !== "down") {
      upsertDeviceState(d.id, { state: "stale" });
      updated.push({ deviceId: d.id, ageMs });
    }
  }
  return { swept: updated.length, updated };
}

/** Subscribe to scheduler events (state_change, probe_result). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-sync scheduler when a device is added/updated/deleted while running. */
export function refreshDevice(deviceId) {
  if (!running) return;
  const device = getDevice(deviceId);
  const existing = timers.get(deviceId);
  if (existing) { clearTimeout(existing); timers.delete(deviceId); }
  if (device && device.enabled) scheduleNext(deviceId, jitter(2000));
}

/** Test-only: run one tick synchronously without scheduling next. */
export async function _testTickOnce(deviceId) {
  // Used by tests — bypasses `running` guard and timer chain.
  const wasRunning = running;
  running = true;
  await runOnce(deviceId);
  // Cancel any timer that runOnce queued for the next tick.
  const t = timers.get(deviceId);
  if (t) { clearTimeout(t); timers.delete(deviceId); }
  running = wasRunning;
}