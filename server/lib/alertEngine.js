/**
 * Deterministic alert engine. JSON-backed.
 * Generates alerts from probe failures and log correlation results.
 * Never auto-resolves (requires explicit resolve), but dedupes active alerts
 * by (deviceId + patternId/source).
 */
import fs from "node:fs";
import path from "node:path";
import { appendTimelineEvent } from "./failureTimelineStore.js";

const FILE = path.resolve(process.cwd(), "server", "data", "alerts", "alerts.json");

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
function newId() { return "alrt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

function findActive(all, deviceId, dedupeKey) {
  return all.find((a) => a.status === "active" && a.deviceId === deviceId && a.dedupeKey === dedupeKey);
}

export function listAlerts({ status, deviceId } = {}) {
  let all = readAll().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  if (status) all = all.filter((a) => a.status === status);
  if (deviceId) all = all.filter((a) => a.deviceId === deviceId);
  return all;
}

export function getAlert(id) {
  return readAll().find((a) => a.alertId === id) || null;
}

export function createOrUpdateAlert(input) {
  const all = readAll();
  const dedupeKey = String(input.dedupeKey || input.patternId || input.source || "generic");
  const deviceId = input.deviceId || null;
  const now = new Date().toISOString();
  const existing = findActive(all, deviceId, dedupeKey);
  if (existing) {
    existing.updatedAt = now;
    existing.evidence = (existing.evidence || []).concat(input.evidence || []).slice(-30);
    existing.patternIds = Array.from(new Set([...(existing.patternIds || []), ...(input.patternIds || [])]));
    if (input.severity === "critical") existing.severity = "critical";
    if (input.snapshotId) existing.snapshotId = input.snapshotId;
    writeAll(all);
    return { alert: existing, created: false };
  }
  const alert = {
    alertId: newId(),
    createdAt: now,
    updatedAt: now,
    status: "active",
    severity: input.severity || "warning",
    deviceId,
    deviceName: input.deviceName || null,
    dedupeKey,
    title: String(input.title || "Alert"),
    description: input.description || "",
    evidence: input.evidence || [],
    patternIds: input.patternIds || [],
    snapshotId: input.snapshotId || null,
    timelineEventIds: [],
    deterministicCause: input.deterministicCause || null,
    recommendedNextCheck: input.recommendedNextCheck || null,
    source: input.source || "deterministic",
  };
  all.push(alert);
  writeAll(all);
  try {
    const tl = appendTimelineEvent({
      source: "alert",
      deviceId,
      severity: alert.severity,
      title: `Alert created: ${alert.title}`,
      description: alert.description,
      alertId: alert.alertId,
    });
    alert.timelineEventIds.push(tl.eventId);
    writeAll(all);
  } catch {}
  return { alert, created: true };
}

export function ackAlert(id) {
  const all = readAll();
  const a = all.find((x) => x.alertId === id);
  if (!a) return null;
  a.status = "acknowledged";
  a.updatedAt = new Date().toISOString();
  writeAll(all);
  appendTimelineEvent({ source: "alert", deviceId: a.deviceId, severity: "info", title: `Alert acknowledged: ${a.title}`, alertId: a.alertId });
  return a;
}

export function resolveAlert(id) {
  const all = readAll();
  const a = all.find((x) => x.alertId === id);
  if (!a) return null;
  a.status = "resolved";
  a.updatedAt = new Date().toISOString();
  writeAll(all);
  appendTimelineEvent({ source: "alert", deviceId: a.deviceId, severity: "info", title: `Alert resolved: ${a.title}`, alertId: a.alertId });
  return a;
}

/** Convenience: generate alerts from a probe result. */
export function alertFromProbe({ device, evidence }) {
  if (!device || !evidence) return null;
  if (evidence.ok) return null;
  const sev = device.critical ? "critical" : "warning";
  return createOrUpdateAlert({
    deviceId: device.id,
    deviceName: device.name,
    severity: sev,
    source: "probe",
    dedupeKey: `probe:${evidence.protocol}`,
    title: `${device.name || device.id} probe failed (${evidence.protocol.toUpperCase()})`,
    description: evidence.error || "Probe returned not-ok",
    evidence: [{ kind: "probe", at: evidence.timestamp, error: evidence.error, latencyMs: evidence.latencyMs }],
    deterministicCause: `${evidence.protocol} probe to ${device.host || device.url || "?"} failed`,
    recommendedNextCheck: "Check network path, then service-specific log path.",
  }).alert;
}

/** Convenience: generate alerts from log correlation events. */
export function alertsFromCorrelation({ device, correlatedEvents }) {
  const out = [];
  for (const ev of correlatedEvents || []) {
    if (ev.severity !== "critical" && ev.severity !== "warning") continue;
    const r = createOrUpdateAlert({
      deviceId: device?.id || ev.deviceId,
      deviceName: device?.name || null,
      severity: ev.severity,
      source: "log_pattern",
      dedupeKey: `pattern:${ev.patternId}`,
      patternIds: [ev.patternId],
      title: ev.title,
      description: ev.explanation,
      evidence: ev.evidenceLines.map((l) => ({ kind: "log_line", line: l })),
      deterministicCause: `${ev.patternId} matched ${ev.occurrences}× in recent logs`,
      recommendedNextCheck: ev.recommendedNextCheck,
    });
    out.push(r.alert);
  }
  return out;
}