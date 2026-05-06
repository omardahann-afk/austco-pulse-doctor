/**
 * Health DB — SQLite-backed persistent store for the live monitoring engine.
 *
 * Tables:
 *   devices       — registered targets (id, name, kind, host, port, url, tls, ...)
 *   probe_results — every probe attempt (history). Indexed on device_id + ts.
 *   device_state  — latest known state per device (ok/degraded/down/stale, streaks, latencies).
 *
 * History queries (latency trend, packet loss trend, disconnect frequency) all
 * go through this file. Never store secrets (passwords) in raw — they are
 * stripped before insertion.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PATH = process.env.TACERA_DB_PATH || "/tmp/tacera-doctor-health.db";
let db = null;
let openedAt = null;
let dbPath = null;

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function openDb(filePath = DEFAULT_PATH) {
  if (db && dbPath === filePath) return db;
  if (db) { try { db.close(); } catch {} db = null; }
  ensureDir(filePath);
  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      kind        TEXT NOT NULL,            -- controller|gateway|broker|service|generic
      protocol    TEXT NOT NULL,            -- icmp|tcp|https|mqtt
      host        TEXT,
      port        INTEGER,
      url         TEXT,
      tls         INTEGER DEFAULT 0,
      interval_ms INTEGER NOT NULL DEFAULT 30000,
      enabled     INTEGER NOT NULL DEFAULT 1,
      meta        TEXT,                     -- JSON string for extra context
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS probe_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   TEXT NOT NULL,
      ts          TEXT NOT NULL,            -- ISO timestamp
      ts_ms       INTEGER NOT NULL,         -- epoch ms (for fast range scans)
      protocol    TEXT NOT NULL,
      ok          INTEGER NOT NULL,         -- 0/1
      latency_ms  REAL,
      error       TEXT,
      duration_ms INTEGER,
      raw_json    TEXT,                     -- structured raw payload from probe
      source      TEXT,                     -- VM hostname that ran the probe
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_probe_device_ts ON probe_results(device_id, ts_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_probe_ts        ON probe_results(ts_ms DESC);
    CREATE TABLE IF NOT EXISTS device_state (
      device_id        TEXT PRIMARY KEY,
      state            TEXT NOT NULL,        -- up|degraded|down|stale|unknown
      last_ok_ts       TEXT,
      last_check_ts    TEXT,
      consecutive_fail INTEGER NOT NULL DEFAULT 0,
      consecutive_ok   INTEGER NOT NULL DEFAULT 0,
      backoff_ms       INTEGER NOT NULL DEFAULT 0,
      latency_ms_avg   REAL,
      packet_loss_pct  REAL,
      last_error       TEXT,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  // Additive Phase 7 columns. Idempotent — only adds if missing.
  migrateDevicesAddTaceraColumns(db);
  dbPath = filePath;
  openedAt = new Date().toISOString();
  return db;
}

function migrateDevicesAddTaceraColumns(d) {
  const cols = d.prepare("PRAGMA table_info(devices)").all().map((c) => c.name);
  const additions = [
    ["device_type",      "TEXT"],
    ["critical",         "INTEGER DEFAULT 0"],
    ["parent_device_id", "TEXT"],
    ["mqtt_topics",      "TEXT"],   // JSON
    ["expected_services","TEXT"],   // JSON
    ["site_zone",        "TEXT"],
    ["dependencies",     "TEXT"],   // JSON
  ];
  for (const [col, type] of additions) {
    if (!cols.includes(col)) {
      try { d.exec(`ALTER TABLE devices ADD COLUMN ${col} ${type}`); }
      catch (err) { console.warn(`[healthDb] could not add column ${col}:`, err?.message || err); }
    }
  }
}

export function closeDb() {
  if (db) { try { db.close(); } catch {} }
  db = null; dbPath = null; openedAt = null;
}

function getDb() {
  if (!db) openDb();
  return db;
}

/* ---------- Devices ---------- */

function stripSecrets(meta) {
  if (!meta || typeof meta !== "object") return null;
  const clone = { ...meta };
  for (const k of ["password", "passphrase", "privateKey", "key", "secret", "token"]) delete clone[k];
  return clone;
}

export function upsertDevice(d) {
  if (!d?.id || !d?.kind || !d?.protocol) {
    throw new Error("upsertDevice requires { id, kind, protocol }");
  }
  const now = new Date().toISOString();
  const meta = stripSecrets(d.meta) || {};
  // Tacera-aware fields can be passed at the top level OR inside meta.
  const deviceType = d.deviceType ?? meta.taceraType ?? null;
  const critical = d.critical === true || meta.critical === true ? 1 : 0;
  const parentDeviceId = d.parentDeviceId ?? meta.parentDeviceId ?? null;
  const mqttTopics = JSON.stringify(d.mqttTopics ?? meta.mqttTopics ?? []);
  const expectedServices = JSON.stringify(d.expectedServices ?? meta.expectedServices ?? []);
  const siteZone = d.siteZone ?? meta.siteZone ?? null;
  const dependencies = JSON.stringify(d.dependencies ?? meta.dependencies ?? []);
  const row = {
    id: String(d.id),
    name: d.name ?? null,
    kind: String(d.kind),
    protocol: String(d.protocol),
    host: d.host ?? null,
    port: d.port == null ? null : Number(d.port),
    url: d.url ?? null,
    tls: d.tls ? 1 : 0,
    interval_ms: Number(d.intervalMs) || 30000,
    enabled: d.enabled === false ? 0 : 1,
    meta: JSON.stringify(meta),
    device_type: deviceType,
    critical,
    parent_device_id: parentDeviceId,
    mqtt_topics: mqttTopics,
    expected_services: expectedServices,
    site_zone: siteZone,
    dependencies,
  };
  getDb().prepare(`
    INSERT INTO devices (id, name, kind, protocol, host, port, url, tls, interval_ms, enabled, meta,
                         device_type, critical, parent_device_id, mqtt_topics, expected_services, site_zone, dependencies,
                         created_at, updated_at)
    VALUES (@id, @name, @kind, @protocol, @host, @port, @url, @tls, @interval_ms, @enabled, @meta,
            @device_type, @critical, @parent_device_id, @mqtt_topics, @expected_services, @site_zone, @dependencies,
            @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, kind=excluded.kind, protocol=excluded.protocol,
      host=excluded.host, port=excluded.port, url=excluded.url, tls=excluded.tls,
      interval_ms=excluded.interval_ms, enabled=excluded.enabled, meta=excluded.meta,
      device_type=excluded.device_type, critical=excluded.critical,
      parent_device_id=excluded.parent_device_id, mqtt_topics=excluded.mqtt_topics,
      expected_services=excluded.expected_services, site_zone=excluded.site_zone,
      dependencies=excluded.dependencies,
      updated_at=excluded.updated_at
  `).run({ ...row, now });
  return getDevice(row.id);
}

export function getDevice(id) {
  const r = getDb().prepare("SELECT * FROM devices WHERE id = ?").get(id);
  return r ? hydrateDevice(r) : null;
}

export function listDevices({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? "SELECT * FROM devices WHERE enabled = 1 ORDER BY id"
    : "SELECT * FROM devices ORDER BY id";
  return getDb().prepare(sql).all().map(hydrateDevice);
}

export function deleteDevice(id) {
  const info = getDb().prepare("DELETE FROM devices WHERE id = ?").run(id);
  return { deleted: info.changes };
}

function hydrateDevice(r) {
  return {
    id: r.id, name: r.name, kind: r.kind, protocol: r.protocol,
    host: r.host, port: r.port, url: r.url, tls: r.tls === 1,
    intervalMs: r.interval_ms, enabled: r.enabled === 1,
    meta: r.meta ? safeJson(r.meta) : {},
    deviceType: r.device_type ?? null,
    critical: r.critical === 1,
    parentDeviceId: r.parent_device_id ?? null,
    mqttTopics: r.mqtt_topics ? safeJson(r.mqtt_topics) : [],
    expectedServices: r.expected_services ? safeJson(r.expected_services) : [],
    siteZone: r.site_zone ?? null,
    dependencies: r.dependencies ? safeJson(r.dependencies) : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

/* ---------- Probe results ---------- */

export function recordProbeResult(deviceId, evidence) {
  if (!deviceId || !evidence) return null;
  const tsMs = Date.parse(evidence.timestamp) || Date.now();
  const info = getDb().prepare(`
    INSERT INTO probe_results (device_id, ts, ts_ms, protocol, ok, latency_ms, error, duration_ms, raw_json, source)
    VALUES (@device_id, @ts, @ts_ms, @protocol, @ok, @latency_ms, @error, @duration_ms, @raw_json, @source)
  `).run({
    device_id: deviceId,
    ts: evidence.timestamp,
    ts_ms: tsMs,
    protocol: evidence.protocol,
    ok: evidence.ok ? 1 : 0,
    latency_ms: evidence.latencyMs == null ? null : Number(evidence.latencyMs),
    error: evidence.error || null,
    duration_ms: Number(evidence.durationMs) || 0,
    raw_json: JSON.stringify(evidence.raw || {}),
    source: evidence.source || null,
  });
  return info.lastInsertRowid;
}

/** Bounded history. Defaults to last 200 results. */
export function getDeviceHistory(deviceId, { limit = 200 } = {}) {
  return getDb().prepare(`
    SELECT ts, protocol, ok, latency_ms, error, duration_ms, raw_json, source
    FROM probe_results
    WHERE device_id = ?
    ORDER BY ts_ms DESC
    LIMIT ?
  `).all(deviceId, Math.min(2000, Math.max(1, limit))).map((r) => ({
    ts: r.ts, protocol: r.protocol, ok: r.ok === 1,
    latencyMs: r.latency_ms, error: r.error, durationMs: r.duration_ms,
    raw: r.raw_json ? safeJson(r.raw_json) : {}, source: r.source,
  }));
}

/** Aggregate trend stats over the last N results. */
export function getDeviceTrend(deviceId, { limit = 50 } = {}) {
  const rows = getDb().prepare(`
    SELECT ok, latency_ms, raw_json
    FROM probe_results
    WHERE device_id = ?
    ORDER BY ts_ms DESC
    LIMIT ?
  `).all(deviceId, Math.min(500, Math.max(1, limit)));
  if (!rows.length) return { samples: 0 };
  let okCount = 0, latencies = [], packetLoss = [];
  for (const r of rows) {
    if (r.ok === 1) okCount++;
    if (r.latency_ms != null) latencies.push(r.latency_ms);
    if (r.raw_json) {
      const raw = safeJson(r.raw_json);
      if (typeof raw.packetLossPct === "number") packetLoss.push(raw.packetLossPct);
    }
  }
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const max = (a) => a.length ? Math.max(...a) : null;
  const min = (a) => a.length ? Math.min(...a) : null;
  return {
    samples: rows.length,
    successRate: okCount / rows.length,
    failureCount: rows.length - okCount,
    latencyMsAvg: avg(latencies),
    latencyMsMin: min(latencies),
    latencyMsMax: max(latencies),
    packetLossPctAvg: avg(packetLoss),
  };
}

/* ---------- Device state ---------- */

export function getDeviceState(deviceId) {
  return getDb().prepare("SELECT * FROM device_state WHERE device_id = ?").get(deviceId) || null;
}

export function upsertDeviceState(deviceId, patch) {
  const now = new Date().toISOString();
  const existing = getDeviceState(deviceId);
  const merged = {
    device_id: deviceId,
    state: patch.state ?? existing?.state ?? "unknown",
    last_ok_ts: patch.last_ok_ts ?? existing?.last_ok_ts ?? null,
    last_check_ts: patch.last_check_ts ?? existing?.last_check_ts ?? null,
    consecutive_fail: patch.consecutive_fail ?? existing?.consecutive_fail ?? 0,
    consecutive_ok: patch.consecutive_ok ?? existing?.consecutive_ok ?? 0,
    backoff_ms: patch.backoff_ms ?? existing?.backoff_ms ?? 0,
    latency_ms_avg: patch.latency_ms_avg ?? existing?.latency_ms_avg ?? null,
    packet_loss_pct: patch.packet_loss_pct ?? existing?.packet_loss_pct ?? null,
    last_error: patch.last_error ?? existing?.last_error ?? null,
    updated_at: now,
  };
  getDb().prepare(`
    INSERT INTO device_state (device_id, state, last_ok_ts, last_check_ts, consecutive_fail, consecutive_ok, backoff_ms, latency_ms_avg, packet_loss_pct, last_error, updated_at)
    VALUES (@device_id, @state, @last_ok_ts, @last_check_ts, @consecutive_fail, @consecutive_ok, @backoff_ms, @latency_ms_avg, @packet_loss_pct, @last_error, @updated_at)
    ON CONFLICT(device_id) DO UPDATE SET
      state=excluded.state,
      last_ok_ts=excluded.last_ok_ts,
      last_check_ts=excluded.last_check_ts,
      consecutive_fail=excluded.consecutive_fail,
      consecutive_ok=excluded.consecutive_ok,
      backoff_ms=excluded.backoff_ms,
      latency_ms_avg=excluded.latency_ms_avg,
      packet_loss_pct=excluded.packet_loss_pct,
      last_error=excluded.last_error,
      updated_at=excluded.updated_at
  `).run(merged);
  return getDeviceState(deviceId);
}

export function listDeviceStates() {
  return getDb().prepare(`
    SELECT d.id, d.name, d.kind, d.protocol, d.host, d.port, d.url, d.enabled, d.interval_ms,
           s.state, s.last_ok_ts, s.last_check_ts, s.consecutive_fail, s.consecutive_ok,
           s.backoff_ms, s.latency_ms_avg, s.packet_loss_pct, s.last_error
    FROM devices d
    LEFT JOIN device_state s ON s.device_id = d.id
    ORDER BY d.id
  `).all();
}

export function dbInfo() {
  return { path: dbPath, openedAt };
}