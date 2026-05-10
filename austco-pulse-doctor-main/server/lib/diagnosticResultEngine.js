/**
 * Austco/Tacera Diagnostic Result Engine
 * --------------------------------------
 * Deterministic. No AI. Converts probes, active alerts, normalized log
 * meanings, timeline and site correlation into a technician-ready diagnosis:
 * issue -> evidence -> confidence -> next step -> solution -> do-not-do.
 */
import fs from "node:fs";
import path from "node:path";
import { getDevice, listDevices, listDeviceStates } from "./healthDb.js";
import { listAlerts, getAlert } from "./alertEngine.js";
import { listTimelineEvents } from "./failureTimelineStore.js";
import { listSnapshots } from "./evidenceSnapshotStore.js";
import { runSystemCorrelation } from "./systemCorrelationEngine.js";

const DATA_DIR = path.join(process.cwd(), "data", "diagnostics");
const FILE = path.join(DATA_DIR, "results.json");

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n", "utf8");
}
function readAll() {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function writeAll(rows) {
  ensureStore();
  fs.writeFileSync(FILE, JSON.stringify(rows.slice(0, 1000), null, 2), "utf8");
}
function id() { return "diag_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

function profileKey(device) {
  return String(device?.meta?.profileKey || device?.deviceType || device?.kind || "unknown").toLowerCase();
}
function stateFor(deviceId) {
  return (listDeviceStates() || []).find((s) => s.id === deviceId) || null;
}
function activeAlertsFor(deviceId) {
  return (listAlerts({ status: "active", deviceId }) || []);
}
function recentSnapshots(deviceId) { return (listSnapshots({ deviceId }) || []).slice(0, 5); }
function recentTimeline(deviceId) { return (listTimelineEvents({ deviceId, limit: 20 }) || []); }
function lastCheckAgeMinutes(state) {
  const ts = state?.last_check_ts || state?.last_ok_ts;
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : null;
}
function hasText(list, re) {
  return list.some((x) => re.test(`${x.title || ""} ${x.description || ""} ${x.deterministicCause || ""} ${(x.patternIds || []).join(" ")} ${JSON.stringify(x.evidence || [])}`));
}
function accuracyLabel(score) {
  if (score >= 90) return "confirmed";
  if (score >= 70) return "likely";
  if (score >= 45) return "possible";
  return "insufficient evidence";
}
function statusFromState(state) {
  if (!state?.state) return "unknown";
  if (state.state === "up") return "healthy";
  if (state.state === "down") return "down";
  if (state.state === "degraded" || state.state === "stale") return "degraded";
  return "unknown";
}
function evidenceFrom(state, alerts, snapshots, timeline) {
  const ev = [];
  if (state) ev.push({ type: "probe", summary: `${(state.protocol || "probe").toUpperCase()} state is ${state.state || "unknown"}`, detail: state.last_error || null, timestamp: state.last_check_ts || null });
  for (const a of alerts.slice(0, 5)) ev.push({ type: "alert", summary: a.title, severity: a.severity, detail: a.deterministicCause || a.description || null, timestamp: a.updatedAt || a.createdAt });
  for (const s of snapshots.slice(0, 3)) ev.push({ type: "snapshot", summary: `Snapshot ${s.snapshotId}`, detail: s.reason || null, timestamp: s.createdAt });
  for (const e of timeline.slice(0, 5)) ev.push({ type: "timeline", summary: e.title, detail: e.description || null, timestamp: e.createdAt });
  return ev;
}

function defaultProfileDiagnosis({ device, state, alerts }) {
  const key = profileKey(device);
  const down = statusFromState(state) === "down" || statusFromState(state) === "degraded";
  const lastError = String(state?.last_error || "").toLowerCase();

  const base = {
    issueTitle: down ? `${device?.name || device?.id || "Device"} needs attention` : `${device?.name || device?.id || "Device"} appears healthy`,
    issueSummary: down ? "Probe/log evidence indicates this target is not behaving normally." : "Latest available probe evidence does not show a fault.",
    likelyCause: down ? "Unknown until more service-specific evidence is collected." : "No active deterministic fault detected.",
    technicianNextSteps: down ? ["Run Test Now", "View Logs if configured", "Capture Evidence before changing anything"] : ["Continue monitoring", "Capture a snapshot if documenting site health"],
    recommendedSolution: down ? "Collect probe + log evidence, then follow the profile-specific next check." : "No action required.",
    doNotDo: ["Do not restart unrelated services without evidence."],
    escalationNeeded: false,
    customerSafeSummary: down ? "A monitored component is reporting a fault and is under investigation." : "The monitored component is currently healthy.",
    internalTechnicalSummary: down ? "Generic device fault; more evidence required." : "No active deterministic fault.",
  };

  if (/ipc-webmin|webmin/.test(key)) {
    if (down) {
      const auth = hasText(alerts, /auth|login|unauthorized/) || /auth|login|unauthorized/.test(lastError);
      const tls = hasText(alerts, /tls|ssl|cert/) || /tls|ssl|cert/.test(lastError);
      if (auth) return { ...base, issueTitle: "Webmin login/account issue", likelyCause: "MiniServ is reachable but authentication is failing.", recommendedSolution: "Verify Webmin credentials/account lockout. Restart only if service is actually down.", technicianNextSteps: ["Open /var/webmin/miniserv.log", "Confirm account is not locked", "Confirm host reaches port 10000"], doNotDo: ["Do not reboot IPC first.", "Do not restart Pulse Gateway.", "Do not restart INGA."] };
      if (tls) return { ...base, issueTitle: "Webmin TLS/certificate issue", likelyCause: "MiniServ is reachable but TLS negotiation/certificate validation is failing.", recommendedSolution: "Inspect Webmin certificate and system time before restarting services.", technicianNextSteps: ["Check /var/webmin/miniserv.log", "Verify certificate validity", "Verify date/time on IPC"], doNotDo: ["Do not reboot IPC first.", "Do not restart Pulse Gateway."] };
      return { ...base, issueTitle: "Webmin/miniserv unavailable", likelyCause: "Host may be alive but Webmin port 10000/miniserv is not answering.", recommendedSolution: "Check/restart Webmin only after confirming the host is reachable.", technicianNextSteps: ["Ping host", "Check TCP/HTTPS port 10000", "Check miniserv/Webmin service status"], doNotDo: ["Do not reboot IPC first.", "Do not restart Pulse Gateway.", "Do not restart INGA."] };
    }
    return { ...base, issueTitle: "Webmin reachable", issueSummary: "Webmin/MiniServ probe is healthy.", likelyCause: "No Webmin fault detected.", recommendedSolution: "No restart required.", doNotDo: ["Do not restart Webmin when it is healthy."] };
  }

  if (/controller|ip-cct|ip-pst|ip-in8|room-controller/.test(key)) {
    if (hasText(alerts, /low bus voltage|bus voltage/) || /low bus/.test(lastError)) return { ...base, issueTitle: "Controller low bus voltage", likelyCause: "Field power/wiring issue, not a server-side issue.", recommendedSolution: "Check power supply output, bus wiring, loads and controller terminals.", technicianNextSteps: ["Measure voltage at controller", "Inspect field wiring/shorts", "Confirm power supply capacity"], doNotDo: ["Do not restart IPConnect.", "Do not restart Pulse Gateway.", "Do not restart INGA."] };
    if (hasText(alerts, /ip-in8|input active|door|access control/) || /input active|ip-in8|door/.test(lastError)) return { ...base, issueTitle: "Input module receiving active signal", likelyCause: "Nurse call is responding correctly to an active external/input source, commonly access control relay/contact held active.", recommendedSolution: "Verify the upstream access-control/input source before changing nurse-call logic.", technicianNextSteps: ["Check IP-IN8 input state", "Confirm external relay/contact is releasing", "Contact access control contractor if signal remains active"], doNotDo: ["Do not change nurse-call logic before verifying the input source.", "Do not restart Pulse Gateway."] };
    if (down) return { ...base, issueTitle: "Controller unreachable", likelyCause: "PoE/switch port/VLAN/cabling/controller power path issue.", recommendedSolution: "Troubleshoot network/PoE path first.", technicianNextSteps: ["Check switch port link and PoE", "Verify VLAN/IP", "Inspect cabling/patch path", "Power-cycle or replace controller only after network is verified"], doNotDo: ["Do not restart IPConnect first.", "Do not restart Pulse Gateway.", "Do not restart INGA."] };
  }

  if (/ipconnect|ipc/.test(key)) {
    if (hasText(alerts, /license invalid|license expired|license missing/)) return { ...base, issueTitle: "IPConnect license problem", likelyCause: "License Service is unavailable, expired, or not validating IPConnect.", recommendedSolution: "Restore/validate License Service before touching event flow services.", technicianNextSteps: ["Verify License Service endpoint", "Check license validity", "Confirm IPConnect clears license errors"], doNotDo: ["Do not restart MQTT/Pulse first.", "Do not modify controller config before license is valid."] };
    if (hasText(alerts, /config mismatch|call type|tone|staff assist|emergency|display routing/)) return { ...base, issueTitle: "IPConnect configuration/routing mismatch", likelyCause: "Call type, color/tone, group signal, display routing, or section config differs from the known-working area.", recommendedSolution: "Compare the affected section/room against a working room/floor and correct the call/profile mapping.", technicianNextSteps: ["Compare affected section to working room/floor", "Check emergency vs staff assist call type", "Verify tone/filter scheme and display route"], doNotDo: ["Do not assume hardware failure until config is compared.", "Do not restart Pulse Gateway for a call-type mismatch."] };
  }

  if (/pulse-gateway/.test(key)) {
    if (down) return { ...base, issueTitle: "Pulse Gateway service/container unavailable", likelyCause: "Pulse Gateway HTTPS/container/runtime path is degraded.", recommendedSolution: "Inspect container/runtime logs; restart pulse-gateway only if stopped or restart-looping.", technicianNextSteps: ["Check HTTPS 443", "Check pulse-gateway container status", "Review Pulse Gateway logs"], doNotDo: ["Do not restart MQTT without broker evidence.", "Do not reboot VM first.", "Do not restart INGA first."] };
  }

  if (/inga|integration-gateway/.test(key)) {
    if (hasText(alerts, /publish|no ack|queue|broker/)) return { ...base, issueTitle: "INGA event publishing problem", likelyCause: "INGA cannot deliver events, often due to upstream broker/event-flow or downstream integration backpressure.", recommendedSolution: "Verify upstream event flow first, then INGA queue/downstream status.", technicianNextSteps: ["Check broker/event flow health", "Check INGA queue depth", "Check downstream integration/HL7"], doNotDo: ["Do not restart INGA blindly.", "Do not purge queues before evidence capture."] };
  }

  if (/hl7/.test(key)) {
    if (down || hasText(alerts, /ack timeout|nack|mllp|socket|receiver/)) return { ...base, issueTitle: "HL7 receiver not acknowledging", likelyCause: "Downstream HL7 receiver/socket/message validation issue.", recommendedSolution: "Verify downstream receiver port/ACK behavior before restarting local sender.", technicianNextSteps: ["Check receiver TCP port", "Confirm ACK/NACK behavior", "Review rejected message details"], doNotDo: ["Do not restart HL7 until receiver is verified.", "Do not restart INGA if the receiver is down."] };
  }

  if (/rtls/.test(key)) {
    if (down || hasText(alerts, /badge|presence|room resolver|staff assist|cancel/)) return { ...base, issueTitle: "RTLS mapping/event-flow issue", likelyCause: "Badge events, room resolver, or RTLS module path is incomplete or stale.", recommendedSolution: "Verify RTLS modules behind smart call points, room resolver mappings, and badge room association.", technicianNextSteps: ["Confirm RTLS gateway events", "Verify room resolver mapping", "Confirm RTLS modules are installed behind smart call points"], doNotDo: ["Do not assume badge cancel can clear unrelated calls.", "Do not restart IPConnect before confirming RTLS event input."] };
  }

  if (/license/.test(key)) {
    if (down || hasText(alerts, /license/)) return { ...base, issueTitle: "License Service unavailable/invalid", likelyCause: "License endpoint is down, expired, or unreachable.", recommendedSolution: "Restore license service/validity, then verify IPConnect clears license errors.", technicianNextSteps: ["Verify license endpoint", "Verify license expiry", "Check IPConnect after license recovery"], doNotDo: ["Do not restart MQTT/Pulse for license errors."] };
  }

  return base;
}

function confidence({ state, alerts, snapshots, timeline, diagnosis }) {
  let score = 0;
  const parts = [];
  const status = statusFromState(state);
  if (status === "down" || status === "degraded") { score += 30; parts.push({ label: "Probe/state failure matches issue", points: 30 }); }
  else if (status === "healthy") { score += 35; parts.push({ label: "Latest probe/state is healthy", points: 35 }); }
  if (alerts.length > 0) { score += 10; parts.push({ label: "Active alert exists", points: 10 }); }
  if (alerts.some((a) => /log|pattern|correlation/i.test(a.source || "") || (a.patternIds || []).length)) { score += 25; parts.push({ label: "Matching log/correlation pattern", points: 25 }); }
  if (alerts.some((a) => (a.evidence || []).length >= 3)) { score += 20; parts.push({ label: "Repeated evidence observed", points: 20 }); }
  if (timeline.length >= 2) { score += 15; parts.push({ label: "Timeline confirms sequence", points: 15 }); }
  if (snapshots.length > 0) { score += 10; parts.push({ label: "Evidence snapshot exists", points: 10 }); }
  const age = lastCheckAgeMinutes(state);
  if (age == null) { score -= 30; parts.push({ label: "Missing probe result", points: -30 }); }
  else if (age > 15) { score -= 20; parts.push({ label: "Evidence older than 15 min", points: -20 }); }
  if (!alerts.length && /unavailable|unreachable|problem|fault|issue|down/i.test(diagnosis.issueTitle || "") && status === "healthy") { score -= 20; parts.push({ label: "Contradictory healthy probe", points: -20 }); }
  score = Math.max(0, Math.min(100, score));
  return { score, parts, label: accuracyLabel(score) };
}

export function generateDiagnosticForDevice(deviceId) {
  const device = getDevice(deviceId);
  if (!device) return null;
  const state = stateFor(deviceId);
  const alerts = activeAlertsFor(deviceId);
  const snapshots = recentSnapshots(deviceId);
  const timeline = recentTimeline(deviceId);
  const system = runSystemCorrelation({ devices: listDevices(), deviceStates: listDeviceStates(), activeAlerts: listAlerts({ status: "active" }), timeline: listTimelineEvents({ limit: 100 }) });
  const diag = defaultProfileDiagnosis({ device, state, alerts, snapshots, timeline, system });
  const conf = confidence({ state, alerts, snapshots, timeline, diagnosis: diag });
  const result = {
    resultId: id(),
    createdAt: new Date().toISOString(),
    deviceId: device.id,
    deviceName: device.name || device.id,
    profileKey: profileKey(device),
    status: statusFromState(state),
    issueTitle: diag.issueTitle,
    issueSummary: diag.issueSummary,
    likelyCause: diag.likelyCause,
    confidencePercent: conf.score,
    accuracyLabel: conf.label,
    confidenceMath: conf.parts,
    evidence: evidenceFrom(state, alerts, snapshots, timeline),
    contradictions: conf.parts.filter((p) => p.points < 0),
    technicianNextSteps: diag.technicianNextSteps,
    recommendedSolution: diag.recommendedSolution,
    doNotDo: diag.doNotDo,
    escalationNeeded: diag.escalationNeeded || conf.score < 45,
    customerSafeSummary: diag.customerSafeSummary,
    internalTechnicalSummary: diag.internalTechnicalSummary,
    systemContext: system.rootCauseCandidates?.[0] ? { topRootCause: system.rootCauseCandidates[0].label, confidence: system.rootCauseCandidates[0].confidence } : null,
  };
  persistDiagnostic(result);
  return result;
}

export function persistDiagnostic(result) {
  const all = readAll();
  const withoutSame = all.filter((r) => r.resultId !== result.resultId).slice(0, 999);
  writeAll([result, ...withoutSame]);
  return result;
}
export function listDiagnosticResults({ deviceId } = {}) {
  const all = readAll();
  return deviceId ? all.filter((r) => r.deviceId === deviceId) : all;
}
export function getDiagnosticResult(resultId) {
  return readAll().find((r) => r.resultId === resultId) || null;
}
