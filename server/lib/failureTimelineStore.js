/**
 * Unified failure timeline. JSON-backed black-box recorder.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "server", "data", "timeline", "events.json");
const MAX_EVENTS = 5000;

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
  const trimmed = arr.length > MAX_EVENTS ? arr.slice(-MAX_EVENTS) : arr;
  fs.writeFileSync(FILE, JSON.stringify(trimmed, null, 2), "utf8");
}

function newId() {
  return "tl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function appendTimelineEvent(evt) {
  const all = readAll();
  const event = {
    eventId: newId(),
    createdAt: new Date().toISOString(),
    source: String(evt?.source || "unknown"),
    deviceId: evt?.deviceId || null,
    severity: evt?.severity || "info",
    title: String(evt?.title || ""),
    description: evt?.description || null,
    evidenceRefs: evt?.evidenceRefs || [],
    snapshotId: evt?.snapshotId || null,
    alertId: evt?.alertId || null,
    raw: evt?.raw || null,
  };
  all.push(event);
  writeAll(all);
  return event;
}

export function listTimelineEvents({ deviceId, severity, source, limit = 500 } = {}) {
  let all = readAll().slice().reverse();
  if (deviceId) all = all.filter((e) => e.deviceId === deviceId);
  if (severity) all = all.filter((e) => e.severity === severity);
  if (source) all = all.filter((e) => e.source === source);
  return all.slice(0, Math.max(1, Math.min(2000, Number(limit) || 500)));
}