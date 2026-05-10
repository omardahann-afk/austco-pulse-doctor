/**
 * Process Truth collector — runs read-only commands on each SSH-reachable
 * service VM, scoped to the existing Autopilot allowlist (systemd units +
 * docker container names). Frontend never supplies command strings.
 */
import { remoteExec } from "./safeExec.js";
import { buildAllowlist } from "../sshExecutor.js";

/** Map ServiceRole -> systemd unit name we expect (best-effort). */
const ROLE_TO_UNIT = {
  "Integration Gateway": "integration-gateway",
  "Pulse Gateway": "pulse-gateway",
  "Pulse Manage": "pulse-manage",
  "License Service": "license-service",
  "MQTT Broker": "mosquitto",
  "WebSocket MQTT Adapter": null,
  "IPConnect": "ipconnect",
  "RTLS Gateway": "rtls-gateway",
  "HL7": "hl7",
  "File Server": "file-server",
  "Mobile Gateway": "mobile-gateway",
};

const SAFE_NAME = /^[a-z0-9._-]{1,64}$/;

function pickUnit(service, allowlist) {
  const candidate = ROLE_TO_UNIT[service.role];
  if (candidate && SAFE_NAME.test(candidate) && allowlist.systemd.includes(candidate)) return candidate;
  return null;
}

async function rx(svc, cmd, timeout = 8_000) {
  return remoteExec({ host: svc.host, port: svc.port || 22, username: svc.username, password: svc.password || "" }, cmd, timeout);
}

function shortLines(s, n) {
  return (s || "").split("\n").slice(0, n).join("\n");
}

export async function collectProcessTruthForService(service, allowlist) {
  const out = {
    serviceId: service.id,
    name: service.name,
    role: service.role,
    host: service.host,
    sshConnected: false,
    unit: null,
    isActive: null,
    statusSummary: null,
    journalTail: null,
    dockerPs: null,
    uptime: null,
    diskFree: null,
    memFree: null,
    issues: [],
    skipped: false,
    skipReason: null,
    raw: {},
  };

  if (!service.host || !service.username) {
    out.skipped = true; out.skipReason = "no SSH host/username configured"; return out;
  }
  if (!service.password) {
    out.skipped = true; out.skipReason = "no SSH password supplied"; return out;
  }

  // uptime probe also doubles as SSH reachability check
  const upt = await rx(service, "uptime");
  if (!upt.ok && (upt.stage === "ssh_error" || upt.stage === "connect_error" || upt.stage === "timeout")) {
    out.skipped = true; out.skipReason = `ssh ${upt.stage}: ${upt.error || ""}`.trim();
    out.issues.push({ kind: "ssh_unreachable", detail: out.skipReason });
    return out;
  }
  out.sshConnected = true;
  out.uptime = upt.ok ? (upt.stdout || "").trim() : null;
  out.raw.uptime = upt;

  const unit = pickUnit(service, allowlist);
  out.unit = unit;
  if (unit) {
    const isAct = await rx(service, `systemctl is-active ${unit}`);
    out.isActive = (isAct.stdout || "").trim();
    out.raw.is_active = isAct;
    const statusR = await rx(service, `systemctl status ${unit} --no-pager -n 30`);
    out.statusSummary = shortLines(statusR.stdout, 12);
    out.raw.status = statusR;
    if (out.isActive && out.isActive !== "active") {
      out.issues.push({ kind: "service_inactive", detail: `${unit} is ${out.isActive}` });
    }
    const jR = await rx(service, `journalctl -u ${unit} --no-pager -n 100`);
    out.journalTail = shortLines(jR.stdout, 30);
    out.raw.journal = jR;
  } else {
    out.issues.push({ kind: "no_unit_mapping", detail: `No systemd unit mapped for role '${service.role}'` });
  }

  const dps = await rx(service, "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}'");
  if (dps.ok) {
    const lines = (dps.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
    out.dockerPs = lines.map((l) => {
      const [name, status, image] = l.split("\t");
      return { name, status, image };
    });
    // detect restart loops
    for (const c of out.dockerPs) {
      if (/Restarting/i.test(c.status || "")) out.issues.push({ kind: "container_restarting", detail: `${c.name}: ${c.status}` });
    }
  }
  out.raw.docker_ps = dps;

  const df = await rx(service, "df -h");
  if (df.ok) out.diskFree = shortLines(df.stdout, 10);
  out.raw.df = df;

  const fr = await rx(service, "free -m");
  if (fr.ok) out.memFree = (fr.stdout || "").trim();
  out.raw.free = fr;

  return out;
}

export async function collectProcessTruth(services, siteOverrides = {}) {
  const allowlist = buildAllowlist(siteOverrides);
  const out = [];
  for (const s of services) out.push(await collectProcessTruthForService(s, allowlist));
  return { collectedAt: new Date().toISOString(), services: out };
}