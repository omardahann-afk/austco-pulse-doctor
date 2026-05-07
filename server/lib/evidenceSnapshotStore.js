/**
 * Immutable evidence snapshot store. JSON-backed.
 * Snapshots bundle deterministic evidence captured at a point in time.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "server", "data", "evidence", "snapshots.json");

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf8");
}

function readAll() {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || []; }
  catch { return []; }
}

function writeAll(arr) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), "utf8");
}

function newId() {
  return "snap_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function listSnapshots({ deviceId } = {}) {
  const all = readAll().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (deviceId) return all.filter((s) => s.device?.id === deviceId);
  return all;
}

export function getSnapshot(id) {
  return readAll().find((s) => s.snapshotId === id) || null;
}

export function createSnapshot(payload) {
  const all = readAll();
  const snapshot = {
    snapshotId: newId(),
    createdAt: new Date().toISOString(),
    reason: String(payload?.reason || "manual"),
    device: payload?.device || null,
    probe: payload?.probe || null,
    logs: payload?.logs || null,
    alerts: payload?.alerts || [],
    timelineEvents: payload?.timelineEvents || [],
    deterministicFindings: payload?.deterministicFindings || [],
    limitations: payload?.limitations || [],
    confidence: payload?.confidence ?? null,
    included: payload?.included || {},
  };
  all.push(snapshot);
  writeAll(all);
  return snapshot;
}