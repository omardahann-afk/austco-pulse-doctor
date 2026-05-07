/**
 * Deterministic Autopilot recommendation engine.
 *
 * Input  : alert + device + latest probe + log correlation events +
 *          evidence snapshot + device profile + timeline events.
 * Output : a recommendation object with allowed / blocked actions,
 *          verification steps, rollback notes, and a risk level.
 *
 * IMPORTANT: AI does NOT choose the action here. The rules below decide
 * deterministically. AI is only allowed to *explain* the recommendation
 * downstream.
 */
import fs from "node:fs";
import path from "node:path";
import { getAlert } from "./alertEngine.js";
import { listTimelineEvents } from "./failureTimelineStore.js";
import { listSnapshots } from "./evidenceSnapshotStore.js";

const FILE = path.resolve(process.cwd(), "server", "data", "autopilot", "recommendations.json");

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf8");
}
function readAll() {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || []; } catch { return []; }
}
function writeAll(arr) { ensureFile(); fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), "utf8"); }
function newId() { return "rec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

/* ------------------------------------------------------------------ */
/* Rules — pure deterministic                                          */
/* ------------------------------------------------------------------ */

/** @returns {null | { title, summary, matchedReason, riskLevel, allowedActions, blockedActions, verificationSteps, rollbackNotes, requiresApproval }} */
function classify({ alert, device }) {
  const kind = String(device?.kind || "").toLowerCase();
  const patterns = (alert?.patternIds || []).map((p) => String(p).toLowerCase());
  const text = `${alert?.title || ""} ${alert?.description || ""} ${alert?.deterministicCause || ""}`.toLowerCase();
  const dedupe = String(alert?.dedupeKey || "").toLowerCase();

  const hits = (...needles) => needles.some((n) => text.includes(n) || dedupe.includes(n) || patterns.some((p) => p.includes(n)));

  // 1. WEBMIN DOWN
  if (kind === "ipc-webmin" || hits("webmin", "miniserv")) {
    return {
      title: "Restart Webmin service",
      summary: "Webmin (miniserv) is not responding on its HTTPS admin port. Restarting the service usually restores access without affecting underlying VM workloads.",
      matchedReason: "Probe/log evidence indicates Webmin miniserv is down.",
      riskLevel: "MEDIUM",
      allowedActions: [
        { id: "restart_webmin", label: "Restart webmin service", command: "systemctl restart webmin" },
      ],
      blockedActions: [
        { id: "reboot_vm", label: "Reboot VM", reason: "Reboot is disproportionate for a single web admin daemon." },
      ],
      verificationSteps: [
        "Confirm HTTPS responds on port 10000",
        "Confirm `systemctl is-active webmin` returns active",
      ],
      rollbackNotes: ["Restart is idempotent; if it fails, capture journalctl -u webmin and escalate."],
      requiresApproval: true,
    };
  }

  // 2. MQTT BROKER DOWN
  if (kind === "mqtt-broker" || hits("mosquitto", "mqtt connect", "mqtt disconnected", "broker unreachable")) {
    return {
      title: "Check (and optionally restart) MQTT broker",
      summary: "MQTT broker is not accepting connections or is stale. Inspect mosquitto status before restarting; a restart will drop active subscribers.",
      matchedReason: "MQTT connect/freshness probe failed or correlated mosquitto pattern detected.",
      riskLevel: "MEDIUM",
      allowedActions: [
        { id: "status_mosquitto", label: "Check mosquitto service status", command: "systemctl status mosquitto" },
        { id: "restart_mosquitto", label: "Restart mosquitto", command: "systemctl restart mosquitto" },
      ],
      blockedActions: [
        { id: "restart_pulse_gateway", label: "Restart Pulse Gateway", reason: "Do not restart Pulse Gateway until broker is verified — it will reconnect on its own." },
      ],
      verificationSteps: [
        "TCP 1883 open",
        "MQTT connect succeeds",
        "xcare/# topic publishes within 30 s",
      ],
      rollbackNotes: ["Subscribers reconnect automatically. If broker fails to start, restore mosquitto.conf from backup."],
      requiresApproval: true,
    };
  }

  // 3. PULSE GATEWAY DEGRADED
  if (kind === "pulse-gateway" || hits("pulse gateway", "pulse-gateway", "container exited")) {
    return {
      title: "Inspect Pulse Gateway, restart container only if down",
      summary: "Pulse Gateway HTTPS or MQTT side is degraded. Read recent container logs first; only restart the container if it has exited.",
      matchedReason: "Pulse Gateway probe/log evidence indicates degraded state.",
      riskLevel: "MEDIUM",
      allowedActions: [
        { id: "logs_pulse", label: "Tail pulse-gateway logs", command: "docker logs --tail=200 pulse-gateway" },
        { id: "restart_pulse_container", label: "Restart pulse-gateway container (only if exited)", command: "docker restart pulse-gateway" },
      ],
      blockedActions: [
        { id: "reboot_ipc_vm", label: "Reboot IPC VM", reason: "VM reboot is unsafe; container restart is the bounded action." },
      ],
      verificationSteps: [
        "HTTPS 443 responds on Pulse Gateway",
        "MQTT events resume on austco/events/#",
      ],
      rollbackNotes: ["Container restart is idempotent. If it loops, capture `docker logs pulse-gateway` and escalate."],
      requiresApproval: true,
    };
  }

  // 4. INGA PUBLISH FAILURE
  if (kind === "inga" || hits("inga", "no ack")) {
    return {
      title: "Verify MQTT broker before touching INGA",
      summary: "INGA cannot publish or is missing acks. Most often the upstream MQTT broker is the real cause; do NOT restart INGA until broker is verified healthy.",
      matchedReason: "INGA publish failure or no-ack pattern detected.",
      riskLevel: "LOW",
      allowedActions: [
        { id: "check_broker", label: "Re-probe MQTT broker", command: "(read-only re-probe)" },
        { id: "tail_inga_logs", label: "Tail INGA logs", command: "(read-only log tail)" },
      ],
      blockedActions: [
        { id: "restart_inga", label: "Restart INGA", reason: "Restarting INGA before broker is verified can mask the actual cause." },
      ],
      verificationSteps: [
        "MQTT broker probe is OK",
        "INGA queue depth is decreasing",
      ],
      rollbackNotes: ["Read-only checks have no rollback."],
      requiresApproval: true,
    };
  }

  // 5. CONTROLLER UNREACHABLE
  if (kind === "controller" || hits("controller", "stale heartbeat", "ping failed")) {
    return {
      title: "MANUAL: investigate switch port / PoE / network",
      summary: "A controller is unreachable. This is almost always a network-layer fault (switch port, PoE, VLAN, cabling). Software restarts upstream will not help and may mask the real issue.",
      matchedReason: "Controller ping failed or heartbeat went stale.",
      riskLevel: "MANUAL",
      allowedActions: [],
      blockedActions: [
        { id: "restart_ipc", label: "Restart IPC", reason: "Will not bring back a controller that is off-network." },
        { id: "restart_pulse_gateway", label: "Restart Pulse Gateway", reason: "Same — gateway restart cannot revive a dead PoE link." },
        { id: "restart_inga", label: "Restart INGA", reason: "Cannot affect controller LAN reachability." },
      ],
      verificationSteps: [
        "Check switch port link/PoE on the controller's port",
        "Verify VLAN and DHCP lease for the controller",
        "Confirm cable / patch panel continuity",
      ],
      rollbackNotes: ["Manual investigation only — no automated remediation available."],
      requiresApproval: true,
    };
  }

  // 6. HL7 ACK TIMEOUT
  if (kind === "hl7" || hits("hl7", "ack timeout")) {
    return {
      title: "Verify downstream HL7 receiver before restart",
      summary: "HL7 sender reports ACK timeouts. The downstream receiver / socket is the most likely cause. Do not restart the local HL7 sender until the receiver is verified.",
      matchedReason: "HL7 ACK timeout pattern detected.",
      riskLevel: "LOW",
      allowedActions: [
        { id: "check_socket", label: "Verify TCP socket to HL7 receiver", command: "(read-only TCP probe)" },
        { id: "tail_hl7_logs", label: "Tail HL7 sender logs", command: "(read-only log tail)" },
      ],
      blockedActions: [
        { id: "restart_hl7", label: "Restart HL7 sender", reason: "Pointless until downstream receiver is verified." },
      ],
      verificationSteps: [
        "TCP socket to HL7 receiver is open",
        "Receiver acknowledges a test message",
      ],
      rollbackNotes: ["Read-only checks have no rollback."],
      requiresApproval: true,
    };
  }

  // 7. CERT / TLS
  if (hits("certificate", "cert expired", "tls handshake", "x509", "ssl error")) {
    return {
      title: "MANUAL: certificate / TLS issue",
      summary: "A certificate has expired or TLS negotiation is failing. Cert renewal must be performed manually with the correct CA chain and verified before reload.",
      matchedReason: "TLS / certificate failure pattern detected.",
      riskLevel: "MANUAL",
      allowedActions: [
        { id: "inspect_cert", label: "Inspect cert expiry", command: "openssl s_client -connect <host>:<port> -servername <host>" },
      ],
      blockedActions: [
        { id: "auto_replace_cert", label: "Automatic cert replacement", reason: "Cert replacement must be supervised — wrong cert breaks the whole site." },
      ],
      verificationSteps: [
        "New cert matches the FQDN",
        "Chain validates against the configured CA",
        "Service reload completes without errors",
      ],
      rollbackNotes: ["Keep the previous cert/key on disk and restore + reload on failure."],
      requiresApproval: true,
    };
  }

  // Fallback — generic inspection only.
  return {
    title: "Inspect device, no automated action available",
    summary: "No deterministic remediation rule matched this alert. Run read-only inspection and escalate if needed.",
    matchedReason: "No rule matched — generic inspection recommendation.",
    riskLevel: "MANUAL",
    allowedActions: [],
    blockedActions: [
      { id: "any_restart", label: "Any service restart", reason: "Engine refuses to restart anything without a matched rule." },
    ],
    verificationSteps: ["Re-probe device", "Capture evidence snapshot", "Tail recent logs"],
    rollbackNotes: ["No action taken — nothing to roll back."],
    requiresApproval: true,
  };
}

/* ------------------------------------------------------------------ */
/* Build / persist                                                     */
/* ------------------------------------------------------------------ */

function findLatestSnapshotForDevice(deviceId) {
  if (!deviceId) return null;
  try {
    const list = listSnapshots({ deviceId }) || [];
    return list[0] || null;
  } catch { return null; }
}

/**
 * Build a recommendation from an alert.
 *
 * @param {Object} args
 * @param {Object} args.alert     — full alert object (from alertEngine)
 * @param {Object} [args.device]  — device record (id, name, kind, host, ...)
 * @param {Array}  [args.timeline] — recent timeline events for this device
 * @param {Object} [args.snapshot] — latest evidence snapshot
 */
export function buildRecommendation({ alert, device = null, timeline = null, snapshot = null }) {
  if (!alert) throw new Error("alert required");
  const decision = classify({ alert, device });
  const tl = timeline || (alert.deviceId ? listTimelineEvents({ deviceId: alert.deviceId, limit: 25 }) : []);
  const snap = snapshot || alert.snapshotId
    ? snapshot || null
    : findLatestSnapshotForDevice(alert.deviceId);

  return {
    recommendationId: newId(),
    createdAt: new Date().toISOString(),
    alertId: alert.alertId,
    deviceId: alert.deviceId,
    deviceName: device?.name || alert.deviceName || null,
    deviceKind: device?.kind || null,
    title: decision.title,
    summary: decision.summary,
    matchedReason: decision.matchedReason,
    riskLevel: decision.riskLevel,
    allowedActions: decision.allowedActions,
    blockedActions: decision.blockedActions,
    verificationSteps: decision.verificationSteps,
    rollbackNotes: decision.rollbackNotes,
    requiresApproval: decision.requiresApproval,
    aiCanExplain: true,
    status: "pending",
    decidedBy: "deterministic_engine_v1",
    relatedSnapshotId: snap?.snapshotId || alert.snapshotId || null,
    relatedTimelineEventIds: tl.slice(0, 10).map((e) => e.eventId),
    deterministicCause: alert.deterministicCause || null,
    recommendedNextCheck: alert.recommendedNextCheck || null,
    decision: { rejected: false, approved: false },
  };
}

export function saveRecommendation(rec) {
  const all = readAll();
  // Replace existing for same alertId+pending OR append.
  const idx = all.findIndex((r) => r.alertId === rec.alertId && r.status === "pending");
  if (idx >= 0) all[idx] = rec; else all.unshift(rec);
  writeAll(all.slice(0, 500));
  return rec;
}

export function listRecommendations() { return readAll(); }
export function getRecommendation(id) { return readAll().find((r) => r.recommendationId === id) || null; }

export function approveRecommendation(id, { actor = "technician" } = {}) {
  const all = readAll();
  const r = all.find((x) => x.recommendationId === id);
  if (!r) return null;
  r.status = "approved";
  r.decision = { ...(r.decision || {}), approved: true, approvedAt: new Date().toISOString(), actor };
  writeAll(all);
  return r;
}

export function rejectRecommendation(id, { actor = "technician", reason = null } = {}) {
  const all = readAll();
  const r = all.find((x) => x.recommendationId === id);
  if (!r) return null;
  r.status = "rejected";
  r.decision = { ...(r.decision || {}), rejected: true, rejectedAt: new Date().toISOString(), actor, reason };
  writeAll(all);
  return r;
}

/** Convenience: build + persist from an alertId, looking up associated data. */
export function recommendFromAlertId(alertId, { device = null } = {}) {
  const alert = getAlert(alertId);
  if (!alert) return null;
  const rec = buildRecommendation({ alert, device });
  return saveRecommendation(rec);
}