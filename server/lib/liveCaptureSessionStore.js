/**
 * Live Capture Session Store
 * --------------------------
 * JSON-backed persistence for the technician's "live incident capture"
 * workflow:
 *
 *   1. start            (status: capturing)
 *   2. mark reproduction started   (status: reproduction_active)
 *   3. mark reproduction finished  (status: capturing)  // window closed but
 *                                                       // capture continues
 *                                                       // until stop
 *   4. stop             (status: stopped)
 *   5. analyze          (status: analyzing → complete | failed)
 *
 * The reproduction window (reproductionStartedAt..reproductionEndedAt) is the
 * single most important field: the M2 correlator prioritises events inside it.
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "server", "data", "live-captures", "sessions.json");

export const CAPTURE_STATUSES = Object.freeze([
  "idle",
  "capturing",
  "reproduction_active",
  "stopped",
  "analyzing",
  "complete",
  "failed",
]);

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf8");
}
function readAll() {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || []; } catch { return []; }
}
function writeAll(arr) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), "utf8");
}
function newId() {
  return "cap_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function blankSession(input) {
  const now = new Date().toISOString();
  return {
    sessionId: newId(),
    status: "capturing",
    createdAt: now,
    startedAt: now,
    reproductionStartedAt: null,
    reproductionEndedAt: null,
    stoppedAt: null,
    problemStatement: String(input?.problemStatement || "").slice(0, 2000),
    room: String(input?.room || "").slice(0, 200),
    callpoint: String(input?.callpoint || "").slice(0, 200),
    expectedBehavior: String(input?.expectedBehavior || "").slice(0, 2000),
    actualBehavior: String(input?.actualBehavior || "").slice(0, 2000),
    technicianNotes: String(input?.technicianNotes || "").slice(0, 4000),
    devicesIncluded: Array.isArray(input?.devicesIncluded)
      ? input.devicesIncluded.map((d) => ({
          id: String(d?.id || ""),
          name: String(d?.name || ""),
          kind: String(d?.kind || ""),
          host: String(d?.host || ""),
          applianceType: String(d?.applianceType || ""),
        })).filter((d) => d.id)
      : [],
    rawEvidence: [],          // [{ at, deviceId, source, kind, payload }]
    normalizedEvents: [],     // forensic events from taceraEventNormalizer
    incidentChains: [],       // populated in M2
    diagnosisResult: null,    // populated in M2
    developerPackage: null,   // populated in M2
  };
}

/* -------------------------------- CRUD -------------------------------- */

export function listSessions() {
  return readAll().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function getSession(id) {
  return readAll().find((s) => s.sessionId === id) || null;
}

export function createSession(input) {
  const all = readAll();
  const session = blankSession(input);
  all.push(session);
  writeAll(all);
  return session;
}

function update(sessionId, mut) {
  const all = readAll();
  const idx = all.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) return null;
  const next = mut({ ...all[idx] });
  if (!next) return all[idx];
  all[idx] = next;
  writeAll(all);
  return next;
}

export function markReproductionStarted(sessionId) {
  return update(sessionId, (s) => {
    if (s.status !== "capturing" && s.status !== "reproduction_active") {
      throw new Error(`cannot mark reproduction started from status=${s.status}`);
    }
    s.reproductionStartedAt = new Date().toISOString();
    s.status = "reproduction_active";
    return s;
  });
}

export function markReproductionFinished(sessionId) {
  return update(sessionId, (s) => {
    if (s.status !== "reproduction_active") {
      throw new Error(`cannot mark reproduction finished from status=${s.status}`);
    }
    s.reproductionEndedAt = new Date().toISOString();
    s.status = "capturing"; // window closed; capture continues until stop
    return s;
  });
}

export function stopSession(sessionId) {
  return update(sessionId, (s) => {
    if (s.status === "complete" || s.status === "failed") return s;
    s.stoppedAt = new Date().toISOString();
    // If reproduction window was opened but never closed, close it now.
    if (s.reproductionStartedAt && !s.reproductionEndedAt) {
      s.reproductionEndedAt = s.stoppedAt;
    }
    s.status = "stopped";
    return s;
  });
}

/** Append raw evidence (log lines / probe results / snapshots) and any pre-normalized events. */
export function appendEvidence(sessionId, { rawEvidence = [], normalizedEvents = [] }) {
  return update(sessionId, (s) => {
    if (s.status === "complete" || s.status === "failed" || s.status === "stopped") {
      // Allow late append only while live; once stopped, ignore silently.
      return s;
    }
    if (Array.isArray(rawEvidence) && rawEvidence.length) {
      for (const r of rawEvidence) s.rawEvidence.push(r);
    }
    if (Array.isArray(normalizedEvents) && normalizedEvents.length) {
      for (const e of normalizedEvents) s.normalizedEvents.push(e);
    }
    // Cap to keep file sizes sane (oldest dropped first).
    const RAW_MAX = 5000, EVT_MAX = 5000;
    if (s.rawEvidence.length > RAW_MAX) s.rawEvidence.splice(0, s.rawEvidence.length - RAW_MAX);
    if (s.normalizedEvents.length > EVT_MAX) s.normalizedEvents.splice(0, s.normalizedEvents.length - EVT_MAX);
    return s;
  });
}

/** Set analysis status / result (used by M2 analyze endpoint). */
export function setAnalysisStatus(sessionId, status) {
  return update(sessionId, (s) => { s.status = status; return s; });
}

export function setAnalysisResult(sessionId, { diagnosisResult, developerPackage, incidentChains }) {
  return update(sessionId, (s) => {
    if (diagnosisResult !== undefined) s.diagnosisResult = diagnosisResult;
    if (developerPackage !== undefined) s.developerPackage = developerPackage;
    if (Array.isArray(incidentChains)) s.incidentChains = incidentChains;
    s.status = "complete";
    return s;
  });
}

/** Compute live counters for the UI (no persistence). */
export function sessionCounters(s) {
  if (!s) return null;
  let errors = 0, warnings = 0;
  const callpoints = new Set(), appliances = new Set(), eventTypes = new Set();
  for (const e of s.normalizedEvents || []) {
    if (e.severity === "critical") errors++;
    else if (e.severity === "warning") warnings++;
    if (e.callpointId) callpoints.add(e.callpointId);
    if (e.applianceType) appliances.add(e.applianceType);
    if (e.eventType) eventTypes.add(e.eventType);
  }
  return {
    rawEvidenceCount: (s.rawEvidence || []).length,
    normalizedEventCount: (s.normalizedEvents || []).length,
    errorCount: errors,
    warningCount: warnings,
    affectedCallpoints: Array.from(callpoints),
    affectedAppliances: Array.from(appliances),
    distinctEventTypes: Array.from(eventTypes),
  };
}
