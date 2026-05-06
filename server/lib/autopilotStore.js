/**
 * Autopilot persistence — append-only JSON files under ./data/autopilot/.
 * Newest first. Capped at MAX_HISTORY entries per file.
 * Storage is abstracted behind these helpers so it can be swapped for
 * SQLite/Postgres later without rewriting the engine.
 *
 * Safety:
 *   - Never persists SSH passwords.
 *   - Strips known secret-bearing fields before writing.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "data", "autopilot");
const FILES = {
  plans: path.join(ROOT, "plans.json"),
  executions: path.join(ROOT, "executions.json"),
  scans: path.join(ROOT, "scans.json"),
  approvals: path.join(ROOT, "approvals.json"),
};
const MAX_HISTORY = 500;

function ensureDir() {
  try { fs.mkdirSync(ROOT, { recursive: true }); } catch {}
}

function readArr(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeArr(file, arr) {
  ensureDir();
  const trimmed = arr.slice(0, MAX_HISTORY);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmp, file);
}

const SECRET_KEYS = new Set([
  "password", "passwd", "pass", "secret", "token", "apiKey", "api_key",
  "authorization", "auth", "privateKey", "private_key", "cert", "certificate",
]);

/** Deep-redact known secret-bearing fields. Returns a new value. */
export function redactSecrets(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k)) out[k] = v ? "[redacted]" : "";
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  if (typeof value === "string") {
    // Best-effort redaction of PEM private keys.
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "[redacted private key]";
  }
  return value;
}

function prepend(file, item) {
  const arr = readArr(file);
  arr.unshift(redactSecrets(item));
  writeArr(file, arr);
}

export function savePlan(plan) { prepend(FILES.plans, plan); }
export function loadPlan(planId) {
  return readArr(FILES.plans).find((p) => p && p.planId === planId) || null;
}
export function listRecentPlans(limit = 50) { return readArr(FILES.plans).slice(0, limit); }

export function saveExecution(report) { prepend(FILES.executions, report); }
export function listRecentExecutions(limit = 50) { return readArr(FILES.executions).slice(0, limit); }

export function saveScan(scan) { prepend(FILES.scans, scan); }
export function listRecentScans(limit = 50) { return readArr(FILES.scans).slice(0, limit); }

export function saveApproval(approval) { prepend(FILES.approvals, approval); }
export function listRecentApprovals(limit = 50) { return readArr(FILES.approvals).slice(0, limit); }

export const __paths = FILES;