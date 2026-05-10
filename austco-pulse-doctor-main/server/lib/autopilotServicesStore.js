/**
 * Autopilot Services Registry — persistent JSON store at
 * data/autopilot/services.json.
 *
 * Each entry describes a service Autopilot can scan / build a plan for.
 * This registry is INDEPENDENT of Command Center / siteConfig.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.cwd(), "data", "autopilot");
const FILE = path.join(ROOT, "services.json");

function ensureDir() {
  try { fs.mkdirSync(ROOT, { recursive: true }); } catch {}
}

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeAll(arr) {
  ensureDir();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, FILE);
}

function uid() {
  return "svc_" + crypto.randomBytes(6).toString("hex");
}

function sanitize(input = {}) {
  return {
    id: String(input.id || uid()),
    name: String(input.name || "").trim(),
    type: String(input.type || "custom"),
    role: String(input.role || input.type || "Custom Service"),
    host: String(input.host || "").trim(),
    sshUsername: String(input.sshUsername || "tech"),
    sshPort: Number(input.sshPort) || 22,
    serviceManager: String(input.serviceManager || "systemd"),
    systemdUnit: String(input.systemdUnit || "").trim(),
    dockerContainer: String(input.dockerContainer || "").trim(),
    webminPort: input.webminPort != null && input.webminPort !== "" ? Number(input.webminPort) : null,
    enabled: input.enabled !== false,
    riskLevel: String(input.riskLevel || "MEDIUM"),
    notes: String(input.notes || ""),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function listServices() {
  return readAll();
}

export function upsertService(input) {
  const all = readAll();
  const next = sanitize(input);
  if (!next.name || !next.host) {
    throw new Error("name and host are required");
  }
  const idx = all.findIndex((s) => s.id === next.id);
  if (idx >= 0) {
    next.createdAt = all[idx].createdAt || next.createdAt;
    all[idx] = next;
  } else {
    all.push(next);
  }
  writeAll(all);
  return next;
}

export function deleteService(id) {
  const all = readAll();
  const next = all.filter((s) => s.id !== id);
  writeAll(next);
  return all.length - next.length;
}

/**
 * Adapt a stored Autopilot service entry to the legacy `ServiceEntry` shape
 * consumed by autopilotEngine.runScan / runServiceDiagnosis. Passwords are
 * NEVER persisted server-side; the executor expects them to be passed in
 * separately at execute time.
 */
export function toLegacyServiceEntries(services = []) {
  return services
    .filter((s) => s.enabled !== false)
    .map((s) => ({
      id: s.id,
      role: s.role || s.type,
      name: s.name,
      host: s.host,
      hostname: s.host,
      port: s.sshPort || 22,
      username: s.sshUsername || "tech",
      password: "",
      saveCredentials: false,
      enabled: true,
      required: false,
      logPaths: [],
      notes: s.notes || "",
      // hints for serviceManager — engine reads these via siteOverrides too.
      serviceManager: s.serviceManager,
      systemdUnit: s.systemdUnit,
      dockerContainer: s.dockerContainer,
      webminPort: s.webminPort,
    }));
}