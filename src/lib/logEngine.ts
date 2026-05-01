// =========================================================
// Austco Site Doctor — Real Log Diagnostic Engine
// =========================================================
// This module is environment-agnostic. It runs in the browser
// against (a) log payloads returned by the local Node bridge
// (`site-doctor.js`) and (b) raw log text pasted by a technician
// when SSH is unavailable.
//
// Backend contract (add to site-doctor.js):
//   POST /api/diagnosis  body now also accepts:
//     services: ServiceTarget[]
//   Response now also includes:
//     logAnalysis: ServiceLogResult[]
//
// Backend pseudo-code (Node, ssh2):
//   for each service:
//     ssh.connect({ host, port, username, password })
//     sftp.readFile(logPath, 'utf8')  // or `tail -n 2000 file`
//     return { service, ip, status, logStatus, lastUpdated,
//              errors, warnings, keyEvents, tail }
//   on failure: { ..., status: 'unreachable' | 'log_missing', error }
// =========================================================

export type ServiceKind =
  | "Integration Gateway"
  | "Pulse Gateway"
  | "Pulse Manage"
  | "License Service"
  | "MQTT Broker"
  | "WebSocket MQTT Adapter"
  | "IPConnect"
  | "RTLS Gateway"
  | "HL7"
  | "File Server"
  | "Mobile Gateway";

export type ServiceTarget = {
  name: ServiceKind | string;
  ip: string;
  port: number;       // SSH port, default 22
  username: string;   // default 'tech'
  password: string;   // default 'tech' (sent over HTTPS to local bridge only)
  logPaths: string[]; // canonical paths per service
  optional?: boolean;
};

export type LogLine = {
  ts?: string;       // parsed timestamp (ISO or raw)
  level: "ERROR" | "WARN" | "INFO" | "DEBUG" | "OTHER";
  text: string;
  signal?: string;   // ACTIVE | CANCEL | OUTPUT | ACK | QUEUE | EVENT
};

export type ServiceLogResult = {
  service: string;
  ip: string;
  status: "reachable" | "unreachable";
  logStatus: "found" | "missing";
  lastUpdated?: string;
  error?: string;
  errors: LogLine[];
  warnings: LogLine[];
  keyEvents: LogLine[];
  tail: string[];    // last ~50 raw lines for the expanded view
};

// Canonical log paths from Austco field docs
export const SERVICE_DEFAULTS: Record<ServiceKind, { port: number; user: string; pass: string; paths: string[]; optional?: boolean }> = {
  "Integration Gateway":     { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/integration-gateway/logs/integration-gateway.log"] },
  "Pulse Gateway":           { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/pulse-gateway/log/error.log", "/home/xcare/runtime/pulse-gateway/log/access.log"] },
  "Pulse Manage":            { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/configuration/log/app.log"] },
  "License Service":         { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/license/logs/license.log"] },
  "MQTT Broker":             { port: 22, user: "tech", pass: "tech", paths: ["/var/log/mosquitto/mosquitto.log"] },
  "WebSocket MQTT Adapter":  { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/ws-mqtt/logs/ws-mqtt.log"] },
  "IPConnect":               { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/xcare/log/xcare00.log"] },
  "RTLS Gateway":            { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/rtls-gateway/logs/audit.log"], optional: true },
  "HL7":                     { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/hl7/logs/hl7.log"], optional: true },
  "File Server":             { port: 22, user: "tech", pass: "tech", paths: ["/var/log/samba/log.smbd"], optional: true },
  "Mobile Gateway":          { port: 22, user: "tech", pass: "tech", paths: ["/home/xcare/runtime/mobilegateway/logs/moga.log"], optional: true },
};

export function defaultServiceTargets(): ServiceTarget[] {
  return (Object.keys(SERVICE_DEFAULTS) as ServiceKind[]).map((name) => {
    const d = SERVICE_DEFAULTS[name];
    return { name, ip: "", port: d.port, username: d.user, password: d.pass, logPaths: d.paths, optional: d.optional };
  });
}

// ----- Parsing ------------------------------------------------

const ERROR_PAT = /\b(ERROR|FAIL(ED)?|EXCEPTION|FATAL|TIMEOUT|CONNECTION REFUSED|LICENSE FAILED|DNS FAILED|MQTT DISCONNECT(ED)?|NO ROUTE|UNREACHABLE)\b/i;
const WARN_PAT  = /\b(WARN(ING)?|RETRY|DEGRADED|SLOW)\b/i;
const SIGNAL_PAT = /\b(ACTIVE|CANCEL|OUTPUT|ACK|QUEUE|EVENT)\b/i;
const TS_PAT = /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\b/;

export function parseLogText(raw: string, tailSize = 50): {
  errors: LogLine[]; warnings: LogLine[]; keyEvents: LogLine[]; tail: string[]; lastUpdated?: string;
} {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: LogLine[] = [];
  const warnings: LogLine[] = [];
  const keyEvents: LogLine[] = [];
  let lastTs: string | undefined;

  for (const text of lines) {
    const ts = text.match(TS_PAT)?.[1];
    if (ts) lastTs = ts;
    const sig = text.match(SIGNAL_PAT)?.[1]?.toUpperCase();

    if (ERROR_PAT.test(text)) {
      errors.push({ ts, level: "ERROR", text, signal: sig });
    } else if (WARN_PAT.test(text)) {
      warnings.push({ ts, level: "WARN", text, signal: sig });
    }
    if (sig) {
      keyEvents.push({ ts, level: ERROR_PAT.test(text) ? "ERROR" : "INFO", text, signal: sig });
    }
  }

  return {
    errors,
    warnings,
    keyEvents,
    tail: lines.slice(-tailSize),
    lastUpdated: lastTs,
  };
}

export function analyzeRawText(service: string, ip: string, raw: string): ServiceLogResult {
  const p = parseLogText(raw);
  return {
    service, ip,
    status: "reachable",
    logStatus: "found",
    lastUpdated: p.lastUpdated,
    errors: p.errors,
    warnings: p.warnings,
    keyEvents: p.keyEvents,
    tail: p.tail,
  };
}

// ----- Log-driven Breakpoint inference ------------------------

export type LogBreakpoint = {
  failedHandoff: string;      // "Pulse Gateway → Controller"
  evidence: string;           // actual log line
  timestamp?: string;
  responsibleService: string;
  likelyCause: string;
  recommendedFix: string;
};

function findFirst(result: ServiceLogResult | undefined, pred: (l: LogLine) => boolean): LogLine | undefined {
  if (!result) return undefined;
  return result.errors.find(pred) ?? result.warnings.find(pred) ?? result.keyEvents.find(pred);
}

function byService(results: ServiceLogResult[]): Record<string, ServiceLogResult> {
  const out: Record<string, ServiceLogResult> = {};
  for (const r of results) out[r.service] = r;
  return out;
}

export function inferLogBreakpoint(results: ServiceLogResult[]): LogBreakpoint | null {
  if (!results.length) return null;
  const m = byService(results);

  const inga = m["Integration Gateway"];
  const puga = m["Pulse Gateway"];
  const ipc  = m["IPConnect"];
  const moga = m["Mobile Gateway"];
  const mqtt = m["MQTT Broker"];

  // 1) Integration Gateway shows refused/timeout → external system → INGA
  const ingaErr = findFirst(inga, (l) => /CONNECTION REFUSED|TIMEOUT|UNREACHABLE/i.test(l.text));
  if (ingaErr) {
    return {
      failedHandoff: "External System → Integration Gateway",
      evidence: ingaErr.text, timestamp: ingaErr.ts,
      responsibleService: "Integration Gateway",
      likelyCause: "Upstream EHR/HL7/access-control system unreachable from INGA — network, credentials, or remote endpoint down.",
      recommendedFix: "Verify integration endpoint reachability from INGA host; confirm credentials in app.properties; check firewall rule between INGA and external system.",
    };
  }

  // 2) IPConnect config load failure → Pulse Gateway → IPConnect
  const ipcErr = findFirst(ipc, (l) => /config (load )?fail|failed to load|cannot read config/i.test(l.text));
  if (ipcErr) {
    return {
      failedHandoff: "Pulse Gateway → IPConnect",
      evidence: ipcErr.text, timestamp: ipcErr.ts,
      responsibleService: "IPConnect",
      likelyCause: "IPConnect cannot load its configuration from Pulse Gateway / Pulse Manage.",
      recommendedFix: "Verify CCP reachability, ipconnect.austco.local DNS, and that Pulse Manage published a valid config bundle. Restart IPConnect after fix.",
    };
  }

  // 3) MQTT/Mobile disconnected → Pulse Gateway → Mobile Devices
  const mqttErr = findFirst(mqtt, (l) => /DISCONNECT|REFUSED|UNREACHABLE/i.test(l.text))
              ?? findFirst(moga, (l) => /MQTT DISCONNECT|DISCONNECT|UNREACHABLE/i.test(l.text));
  if (mqttErr) {
    return {
      failedHandoff: "Pulse Gateway → Mobile Devices",
      evidence: mqttErr.text, timestamp: mqttErr.ts,
      responsibleService: mqtt && findFirst(mqtt, () => true) ? "MQTT Broker" : "Mobile Gateway",
      likelyCause: "MQTT broker / Mobile Gateway not delivering events to mobile devices.",
      recommendedFix: "Verify mosquitto service, WS-MQTT adapter, certificates, and Mobile Gateway connectivity to the broker.",
    };
  }

  // 4) Pulse Gateway has OUTPUT but no ACK in any controller-side evidence
  const output = findFirst(puga, (l) => l.signal === "OUTPUT");
  if (output) {
    const ack = findFirst(puga, (l) => l.signal === "ACK");
    if (!ack) {
      return {
        failedHandoff: "Pulse Gateway → Controller",
        evidence: output.text, timestamp: output.ts,
        responsibleService: "Pulse Gateway",
        likelyCause: "Output event was generated by Pulse Gateway, but no matching ACK was received from the controller — controller failed to execute output.",
        recommendedFix: "Check controller power, switch port errors on controller uplink, controller heartbeat, and re-test output. Inspect controller logs directly if available.",
      };
    }
  }

  // 5) Pulse Gateway has CANCEL but no follow-up event delivery (display/IP-APP1)
  const cancel = findFirst(puga, (l) => l.signal === "CANCEL");
  if (cancel) {
    const delivered = findFirst(puga, (l) => /push|deliver|sent to display|app1/i.test(l.text));
    if (!delivered) {
      return {
        failedHandoff: "Pulse Gateway → Display (IP-APP1)",
        evidence: cancel.text, timestamp: cancel.ts,
        responsibleService: "Pulse Gateway",
        likelyCause: "Cancel event recorded but no display delivery confirmed — IP-APP1 likely shows stale active call.",
        recommendedFix: "Verify IP-APP1 session/heartbeat, restart display comm service, and confirm display picks up the cancel.",
      };
    }
  }

  // 6) Pulse Gateway has zero events at all → Controller → Pulse Gateway
  if (puga && puga.keyEvents.length === 0) {
    return {
      failedHandoff: "Controller → Pulse Gateway",
      evidence: "No ACTIVE/CANCEL/EVENT entries found in pulse-gateway logs.",
      timestamp: puga.lastUpdated,
      responsibleService: "Pulse Gateway",
      likelyCause: "Controllers are not delivering any events to Pulse Gateway — controller VLAN, DNS (pulse.austco.local), or PuGa proxy mapping is wrong.",
      recommendedFix: "Verify controllers reach pulse.austco.local on the device VLAN, confirm proxy PuGa is up on eth1, and check DNS resolution from the controller side.",
    };
  }

  // 7) Any service unreachable
  const unreachable = results.find((r) => r.status === "unreachable");
  if (unreachable) {
    return {
      failedHandoff: `Technician Laptop → ${unreachable.service} (SSH)`,
      evidence: unreachable.error ?? "SSH connection failed.",
      responsibleService: unreachable.service,
      likelyCause: "Service host unreachable over SSH from the technician laptop.",
      recommendedFix: "Verify VM is powered on, IP correct, port 22 open, and credentials valid. Ping the host and retry.",
    };
  }

  // 8) Log file missing
  const missing = results.find((r) => r.logStatus === "missing");
  if (missing) {
    return {
      failedHandoff: `${missing.service} log file missing`,
      evidence: `Expected log path not found on ${missing.service} (${missing.ip}).`,
      responsibleService: missing.service,
      likelyCause: "Service may not be installed, not running, or logging to a different path.",
      recommendedFix: "Confirm service is installed and active (systemctl status). Verify the canonical log path.",
    };
  }

  return null;
}

export function summarizeLogs(results: ServiceLogResult[]) {
  return {
    totalErrors: results.reduce((a, r) => a + r.errors.length, 0),
    totalWarnings: results.reduce((a, r) => a + r.warnings.length, 0),
    unreachable: results.filter((r) => r.status === "unreachable").length,
    missing: results.filter((r) => r.logStatus === "missing").length,
  };
}
