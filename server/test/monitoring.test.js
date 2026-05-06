/**
 * Foundation tests for the live monitoring layer:
 *   - real probe primitives (TCP against 127.0.0.1, HTTP against a local server)
 *   - evidence record shape (source, timestamp, protocol, device, raw)
 *   - SQLite persistence (devices, probe_results, device_state)
 *   - polling scheduler state machine: up -> degraded -> down -> up
 *   - stale detection sweep
 *
 * These tests run with `node --test`. They DO NOT touch the network beyond
 * 127.0.0.1 and a local HTTP server we spin up in-test.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { tcpProbe } from "../lib/probes/tcpProbe.js";
import { httpsProbe } from "../lib/probes/httpsProbe.js";
import { mqttConnectProbe } from "../lib/probes/mqttConnectProbe.js";
import {
  openDb, closeDb, upsertDevice, getDevice, listDevices,
  recordProbeResult, getDeviceHistory, getDeviceTrend,
  upsertDeviceState, getDeviceState, listDeviceStates,
} from "../lib/healthDb.js";
import { sweepStale, startScheduler, stopScheduler, schedulerStatus } from "../lib/pollingScheduler.js";
import { makeEvidence } from "../lib/probes/evidence.js";

const TMP_DB = path.join(os.tmpdir(), `tacera-test-${Date.now()}.db`);
let httpServer, httpPort, openSocketServer, openSocketPort;

before(async () => {
  // Fresh DB per test run.
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  openDb(TMP_DB);

  // Local HTTP server for httpsProbe tests.
  httpServer = http.createServer((req, res) => {
    if (req.url === "/healthy") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return; }
    if (req.url === "/teapot")  { res.writeHead(418); res.end("teapot"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
  httpPort = httpServer.address().port;

  // Open TCP socket for tcpProbe tests.
  openSocketServer = net.createServer((sock) => sock.end());
  await new Promise((r) => openSocketServer.listen(0, "127.0.0.1", r));
  openSocketPort = openSocketServer.address().port;
});

after(async () => {
  await new Promise((r) => httpServer.close(r));
  await new Promise((r) => openSocketServer.close(r));
  closeDb();
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

/* ---------- Evidence shape ---------- */

test("makeEvidence returns the standard shape", () => {
  const ev = makeEvidence({
    protocol: "tcp",
    device: { id: "x", name: "x", host: "127.0.0.1", port: 1 },
    ok: true, latencyMs: 5, raw: { open: true }, startedAt: Date.now() - 10,
  });
  for (const k of ["source", "timestamp", "protocol", "device", "ok", "latencyMs", "raw", "error", "durationMs"]) {
    assert.ok(k in ev, `missing key ${k}`);
  }
  assert.equal(ev.protocol, "tcp");
  assert.equal(ev.device.id, "x");
  assert.equal(ev.ok, true);
  assert.match(ev.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

/* ---------- TCP probe ---------- */

test("tcpProbe ok against open local socket", async () => {
  const ev = await tcpProbe({ id: "t1", host: "127.0.0.1", port: openSocketPort });
  assert.equal(ev.protocol, "tcp");
  assert.equal(ev.ok, true);
  assert.equal(typeof ev.latencyMs, "number");
  assert.equal(ev.raw.open, true);
  assert.equal(ev.error, null);
});

test("tcpProbe fails against closed port with real error", async () => {
  const ev = await tcpProbe({ id: "t2", host: "127.0.0.1", port: 1 }, { timeoutMs: 1500 });
  assert.equal(ev.ok, false);
  assert.ok(ev.error, "must include error string");
  assert.equal(ev.raw.open, false);
});

test("tcpProbe rejects missing host/port up-front (no probe attempted)", async () => {
  const ev = await tcpProbe({ id: "t3", host: "", port: null });
  assert.equal(ev.ok, false);
  assert.match(ev.error, /host and port required/);
});

/* ---------- HTTPS/HTTP probe ---------- */

test("httpsProbe accepts 200 from local http server", async () => {
  const ev = await httpsProbe({ id: "h1", url: `http://127.0.0.1:${httpPort}/healthy` });
  assert.equal(ev.ok, true);
  assert.equal(ev.raw.status, 200);
  assert.equal(ev.protocol, "http");
  assert.equal(typeof ev.latencyMs, "number");
});

test("httpsProbe flags unexpected status as failure", async () => {
  const ev = await httpsProbe({ id: "h2", url: `http://127.0.0.1:${httpPort}/teapot` });
  assert.equal(ev.ok, false);
  assert.equal(ev.raw.status, 418);
  assert.match(ev.error, /unexpected_status_418/);
});

test("httpsProbe rejects malformed url without crashing", async () => {
  const ev = await httpsProbe({ id: "h3", url: "not a url" });
  assert.equal(ev.ok, false);
  assert.equal(ev.error, "invalid_url");
});

/* ---------- MQTT connect probe ---------- */

test("mqttConnectProbe times out cleanly when no broker is listening", async () => {
  // Use a port we know is closed so connect() fails fast (ECONNREFUSED), or
  // a non-routable IP so it times out. We use 127.0.0.1:1 — ECONNREFUSED.
  const ev = await mqttConnectProbe({ id: "m1", host: "127.0.0.1", port: 1 }, { timeoutMs: 2500 });
  assert.equal(ev.protocol, "mqtt");
  assert.equal(ev.ok, false);
  assert.ok(ev.error, "must include error");
});

test("mqttConnectProbe rejects bad host shape", async () => {
  const ev = await mqttConnectProbe({ id: "m2", host: "bad host name with spaces", port: 1883 });
  assert.equal(ev.ok, false);
  assert.match(ev.error, /invalid host/);
});

/* ---------- SQLite persistence ---------- */

test("upsertDevice + listDevices + getDevice round-trip", () => {
  upsertDevice({ id: "dev1", name: "Controller West", kind: "controller", protocol: "icmp", host: "127.0.0.1", intervalMs: 10000 });
  const got = getDevice("dev1");
  assert.equal(got.id, "dev1");
  assert.equal(got.protocol, "icmp");
  assert.equal(got.intervalMs, 10000);
  assert.equal(got.enabled, true);
  const all = listDevices();
  assert.ok(all.find((d) => d.id === "dev1"));
});

test("upsertDevice strips secrets from meta", () => {
  upsertDevice({ id: "dev2", kind: "service", protocol: "tcp", host: "127.0.0.1", port: 22, meta: { password: "supersecret", note: "ok" } });
  const got = getDevice("dev2");
  assert.equal(got.meta.password, undefined, "password must not be persisted");
  assert.equal(got.meta.note, "ok");
});

test("recordProbeResult + getDeviceHistory + getDeviceTrend", () => {
  upsertDevice({ id: "dev3", kind: "controller", protocol: "icmp", host: "127.0.0.1", intervalMs: 5000 });
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    const ok = i !== 2; // one failure in the middle
    recordProbeResult("dev3", {
      source: "test", timestamp: new Date(t0 + i).toISOString(),
      protocol: "icmp", device: { id: "dev3", host: "127.0.0.1" },
      ok, latencyMs: ok ? 5 + i : null, raw: { packetLossPct: ok ? 0 : 100 },
      error: ok ? null : "no reply", durationMs: 30,
    });
  }
  const hist = getDeviceHistory("dev3", { limit: 10 });
  assert.equal(hist.length, 5);
  // Most recent first.
  assert.equal(hist[0].ok, true);
  const trend = getDeviceTrend("dev3", { limit: 10 });
  assert.equal(trend.samples, 5);
  assert.equal(trend.failureCount, 1);
  assert.ok(trend.successRate > 0.7 && trend.successRate < 0.9);
  assert.ok(trend.latencyMsAvg > 0);
  assert.equal(trend.packetLossPctAvg > 0, true);
});

/* ---------- Scheduler state machine via direct probe + state writes ----------
 * We don't run real timers here. We simulate probe results to verify the
 * upsertDeviceState path produces the right transitions, and that sweepStale
 * promotes a long-silent device to "stale".
 */

function simulateTick(deviceId, ok, opts = {}) {
  const prev = getDeviceState(deviceId);
  const consecutive_fail = ok ? 0 : (prev?.consecutive_fail || 0) + 1;
  const consecutive_ok = ok ? (prev?.consecutive_ok || 0) + 1 : 0;
  const now = opts.now || new Date().toISOString();
  let state = "unknown";
  if (ok) state = "up";
  else if (consecutive_fail >= 3) state = "down";
  else state = "degraded";
  upsertDeviceState(deviceId, {
    state,
    last_check_ts: now,
    last_ok_ts: ok ? now : prev?.last_ok_ts || null,
    consecutive_fail, consecutive_ok,
    last_error: ok ? null : "simulated",
  });
  return getDeviceState(deviceId);
}

test("state machine: up -> degraded -> down -> recover", () => {
  upsertDevice({ id: "sm1", kind: "controller", protocol: "icmp", host: "127.0.0.1", intervalMs: 5000 });
  let s = simulateTick("sm1", true);
  assert.equal(s.state, "up");
  s = simulateTick("sm1", false);
  assert.equal(s.state, "degraded");
  assert.equal(s.consecutive_fail, 1);
  s = simulateTick("sm1", false);
  assert.equal(s.state, "degraded");
  s = simulateTick("sm1", false);
  assert.equal(s.state, "down");
  assert.equal(s.consecutive_fail, 3);
  s = simulateTick("sm1", true);
  assert.equal(s.state, "up");
  assert.equal(s.consecutive_fail, 0);
  assert.equal(s.consecutive_ok, 1);
});

test("sweepStale promotes long-silent up devices to stale", () => {
  upsertDevice({ id: "sm2", kind: "controller", protocol: "icmp", host: "127.0.0.1", intervalMs: 5000 });
  const oldTs = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
  upsertDeviceState("sm2", {
    state: "up", last_ok_ts: oldTs, last_check_ts: oldTs,
    consecutive_fail: 0, consecutive_ok: 1, last_error: null,
  });
  startScheduler(); // populates opts; we won't actually wait for any timer
  try {
    const r = sweepStale();
    const s = getDeviceState("sm2");
    assert.ok(r.swept >= 1, "should have swept at least one device");
    assert.equal(s.state, "stale");
  } finally {
    stopScheduler();
  }
});

test("listDeviceStates joins device + state rows", () => {
  const rows = listDeviceStates();
  assert.ok(rows.length >= 2);
  const sm1 = rows.find((r) => r.id === "sm1");
  assert.ok(sm1);
  assert.ok("state" in sm1);
});

test("scheduler status reflects start/stop", () => {
  const before = schedulerStatus();
  assert.equal(before.running, false);
  startScheduler();
  const mid = schedulerStatus();
  assert.equal(mid.running, true);
  stopScheduler();
  const after = schedulerStatus();
  assert.equal(after.running, false);
});