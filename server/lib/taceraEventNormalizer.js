/**
 * Tacera Forensic Event Normalizer
 * --------------------------------
 * Pure deterministic. No AI. Converts raw log/evidence lines from any
 * Tacera/Austco appliance into normalized FORENSIC events the live-capture
 * correlator (M2) reasons over.
 *
 * Distinct from `taceraLogNormalizer.js` — that one feeds the existing
 * alert/correlation pipeline. This one emits the richer event shape needed
 * by the live-incident-capture / black-box flow:
 *
 *   {
 *     id, timestamp, appliance, applianceType, subsystem,
 *     severity, eventType, rawMessage,
 *     callpointId, room, controllerId, ipAddress, signalType,
 *     serviceName, dependency, confidenceHints[]
 *   }
 */

import { applianceTypeFor, getApplianceProfile } from "./taceraApplianceProfiles.js";

const RX_TS_ISO = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
const RX_TS_SYSLOG = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/;
const RX_CALLPOINT = /\b(\d{1,4}\.\d{1,4}\.\d{1,4}\.\d{1,4})\b/;
const RX_IPV4 = /\b((?:\d{1,3}\.){3}\d{1,3})\b/;
const RX_ROOM = /\broom[:\s_-]+([A-Z0-9][A-Z0-9_\-]{0,15})\b/i;
const RX_CONTROLLER = /\bcontroller[:\s_-]+([A-Z0-9][A-Z0-9_\-]{0,15})\b/i;

function safeIso(raw) {
  if (!raw) return null;
  try {
    // Syslog form like "Mar  3 11:02:14" — assume current year, leave as-is
    if (/^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    const d = new Date(raw.replace(",", "."));
    if (Number.isNaN(d.getTime())) return raw;
    return d.toISOString();
  } catch { return raw; }
}

function newId() {
  return "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Forensic rule table. Each rule contributes one normalized event per match.
 * Rules deliberately kept narrow so confidenceHints accumulate cleanly in M2.
 */
const RULES = [
  // ---------------- INVALID CALLPOINT (CRITICAL — must NOT be classified as MQTT/messaging) ----------------
  {
    re: /Invalid call ?point (?:ID|id|signal attributes|signal)\b/i,
    eventType: "INVALID_CALLPOINT_SIGNAL",
    severity: "critical",
    subsystem: "ipconnect",
    dependency: "ipconnect",
    hints: ["invalid-callpoint-mapping", "stale-config", "stale-integration-replay"],
  },
  // ---------------- WebSocket / Pulse Gateway ----------------
  {
    re: /websocket|ws[ _-]?error|ws[ _-]?disconnect/i,
    eventType: "WEBSOCKET_ERROR",
    severity: "warning",
    subsystem: "pulse-gateway",
    dependency: "pulse-gateway",
    hints: ["pulse-gateway-downstream"],
  },
  // ---------------- Connection refused (covers MQTT 1883, generic) ----------------
  {
    re: /connect\(\) failed \(111: Connection refused\)|ECONNREFUSED|connection refused/i,
    eventType: "CONNECTION_REFUSED",
    severity: "critical",
    subsystem: "network",
    dependency: "network",
    hints: ["upstream-down", "firewall-or-port-closed"],
  },
  // ---------------- Controllers ----------------
  {
    re: /heartbeat (?:lost|missed|timeout)|controller (?:offline|unreachable|lost)/i,
    eventType: "CONTROLLER_HEARTBEAT_LOST",
    severity: "critical",
    subsystem: "controller",
    dependency: "ip-cct",
    hints: ["controller-or-network-root", "check-poe", "check-vlan"],
  },
  {
    re: /low bus voltage|bus voltage low|undervoltage/i,
    eventType: "LOW_BUS_VOLTAGE",
    severity: "critical",
    subsystem: "controller",
    dependency: "ip-cct",
    hints: ["controller-or-power-root"],
  },
  // ---------------- Access control input ----------------
  {
    re: /IP-?IN8|access[- ]?control input|input (\d+) active|dry contact (?:active|closed)/i,
    eventType: "ACCESS_INPUT_ACTIVE",
    severity: "warning",
    subsystem: "access-input",
    dependency: "access-input",
    hints: ["access-control-source", "not-nurse-call"],
  },
  // ---------------- RTLS ----------------
  {
    re: /rtls.*(?:room.*map|mapping (?:fail|missing))|badge.*(?:room|map).*(?:fail|missing)/i,
    eventType: "RTLS_ROOM_MAPPING_FAILURE",
    severity: "critical",
    subsystem: "rtls",
    dependency: "rtls-gateway",
    hints: ["rtls-mapping-root"],
  },
  {
    re: /rtls.*(?:cancel|presence).*(?:limit|unavailable|not supported)|badge cancel.*not/i,
    eventType: "RTLS_BADGE_CANCEL_LIMITATION",
    severity: "warning",
    subsystem: "rtls",
    dependency: "rtls-gateway",
    hints: ["rtls-mapping-root"],
  },
  // ---------------- PST ----------------
  {
    re: /Logging level set to LOG_TRACE/i,
    eventType: "PST_TRACE_ENABLED",
    severity: "warning",
    subsystem: "pst",
    dependency: "ip-pst",
    hints: ["pst-disk-risk", "log-overflow"],
  },
  {
    re: /Logging level set to LOG_(?:DEBUG|INFO|WARN|ERROR)/i,
    eventType: "PST_LOG_LEVEL_CHANGED",
    severity: "info",
    subsystem: "pst",
    dependency: "ip-pst",
    hints: [],
  },
  {
    re: /(?:disk (?:full|nearly full|usage \d{2,3}%))|no space left on device/i,
    eventType: "PST_DISK_RISK",
    severity: "critical",
    subsystem: "linux-vm",
    dependency: "ip-pst",
    hints: ["pst-disk-risk"],
  },
  // ---------------- HL7 ----------------
  {
    re: /HL7.*(?:ack timeout|no ack|MLLP timeout)/i,
    eventType: "HL7_ACK_TIMEOUT",
    severity: "warning",
    subsystem: "hl7",
    dependency: "hl7",
    hints: ["hl7-downstream"],
  },
  // ---------------- License ----------------
  {
    re: /license (?:invalid|expired|failure|missing)|unable to validate license/i,
    eventType: "LICENSE_FAILURE",
    severity: "critical",
    subsystem: "license",
    dependency: "license-service",
    hints: ["license-root"],
  },
  // ---------------- Pulse Mobile push ports ----------------
  {
    // matches refusal/timeout to a known push port (5223/5228/5229/5230)
    re: /(?:timeout|refused|unreachable|blocked).*\b(5223|5228|5229|5230)\b|\b(5223|5228|5229|5230)\b.*(?:timeout|refused|unreachable|blocked)/i,
    eventType: "PULSE_MOBILE_PORT_BLOCKED",
    severity: "critical",
    subsystem: "pulse-mobile",
    dependency: "pulse-mobile",
    hints: ["firewall-or-network-path", "not-app-crash"],
  },
  // ---------------- Service lifecycle ----------------
  {
    re: /(?:Started|Stopped|Restarted|systemd).*\.service|service.*restarted/i,
    eventType: "SERVICE_RESTARTED",
    severity: "info",
    subsystem: "system",
    dependency: null,
    hints: ["lifecycle"],
  },
  {
    re: /boot recovery|cold ?boot|kernel: Linux version|systemd\[1\]: Started/i,
    eventType: "BOOT_RECOVERY",
    severity: "warning",
    subsystem: "linux-vm",
    dependency: "linux-vm",
    hints: ["recent-reboot", "suppress-window"],
  },
  {
    re: /clock (?:drift|skew)|time jumped|ntp.*(?:unsynced|offset)/i,
    eventType: "CLOCK_DRIFT",
    severity: "warning",
    subsystem: "linux-vm",
    dependency: "linux-vm",
    hints: ["clock-drift"],
  },
];

function extractEntities(line) {
  const cp = line.match(RX_CALLPOINT);
  const ip = line.match(RX_IPV4);
  const room = line.match(RX_ROOM);
  const ctrl = line.match(RX_CONTROLLER);
  return {
    callpointId: cp ? cp[1] : null,
    ipAddress: ip ? ip[1] : null,
    room: room ? room[1] : null,
    controllerId: ctrl ? ctrl[1] : null,
  };
}

function tsFromLine(line, fallback) {
  const iso = line.match(RX_TS_ISO);
  if (iso) return safeIso(iso[1]);
  const sys = line.match(RX_TS_SYSLOG);
  if (sys) return safeIso(sys[1]);
  return fallback || null;
}

/**
 * Normalize a batch of raw lines from one appliance into forensic events.
 *
 * @param {Object} args
 * @param {Object} args.device  registered monitor device row (id, name, kind)
 * @param {string[]} args.lines raw log/evidence lines
 * @param {string} [args.sourcePath] log path the lines came from
 * @param {string} [args.fallbackTimestamp] ISO timestamp to attach if line has none
 * @returns {{ events: Array, applianceType: string }}
 */
export function normalizeForensicEvents({ device, lines, sourcePath, fallbackTimestamp }) {
  const safe = Array.isArray(lines) ? lines : [];
  const applianceType = applianceTypeFor(device?.kind || device?.profileKey || "");
  const profile = getApplianceProfile(applianceType);
  const applianceName = device?.name || device?.host || applianceType;

  const events = [];
  for (const raw of safe) {
    const line = String(raw || "").slice(0, 4000);
    if (!line.trim()) continue;
    const ts = tsFromLine(line, fallbackTimestamp);
    const ent = extractEntities(line);

    let matched = false;
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      matched = true;
      events.push({
        id: newId(),
        timestamp: ts,
        appliance: applianceName,
        applianceType,
        subsystem: rule.subsystem,
        severity: rule.severity,
        eventType: rule.eventType,
        rawMessage: line,
        callpointId: ent.callpointId,
        room: ent.room,
        controllerId: ent.controllerId,
        ipAddress: ent.ipAddress,
        signalType: null,
        serviceName: profile?.displayName || applianceType,
        dependency: rule.dependency,
        confidenceHints: rule.hints || [],
        sourcePath: sourcePath || null,
        sourceDeviceId: device?.id || null,
      });
    }
    if (!matched && /\b(error|fail|fatal|crit|warn)\b/i.test(line)) {
      events.push({
        id: newId(),
        timestamp: ts,
        appliance: applianceName,
        applianceType,
        subsystem: profile?.applianceType || "unknown",
        severity: /fatal|crit/i.test(line) ? "critical" : /error|fail/i.test(line) ? "warning" : "info",
        eventType: "UNKNOWN_ERROR",
        rawMessage: line,
        callpointId: ent.callpointId,
        room: ent.room,
        controllerId: ent.controllerId,
        ipAddress: ent.ipAddress,
        signalType: null,
        serviceName: profile?.displayName || applianceType,
        dependency: null,
        confidenceHints: [],
        sourcePath: sourcePath || null,
        sourceDeviceId: device?.id || null,
      });
    }
  }
  return { events, applianceType };
}

/** Filter events to those whose ISO timestamp lies inside [from, to]. Events with no timestamp keep `inWindow=false`. */
export function eventsInWindow(events, fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return [];
  return (events || []).filter((e) => {
    if (!e.timestamp) return false;
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) return false;
    return t >= from && t <= to;
  });
}
