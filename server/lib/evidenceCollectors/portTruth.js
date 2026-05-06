/**
 * Port Truth collector.
 *
 * Per service VM (where SSH credentials available):
 *   - run `ss -tulpn`
 *   - parse listening sockets and owning process per port
 *   - cross-check expected service-port -> expected owning process
 */
import { remoteExec } from "./safeExec.js";

const COMMON_PORTS = [22, 80, 443, 8080, 8081, 10000, 1883, 8883];

/** Expected owning process keywords per service role (lowercase substring match). */
const ROLE_EXPECTED_PROC = {
  "Integration Gateway": ["java", "integration-gateway"],
  "Pulse Gateway": ["java", "pulse-gateway"],
  "Pulse Manage": ["java", "pulse-manage", "configuration"],
  "License Service": ["license", "java"],
  "MQTT Broker": ["mosquitto"],
  "WebSocket MQTT Adapter": ["node", "websocket"],
  "IPConnect": ["ipconnect", "java"],
  "RTLS Gateway": ["rtls", "java"],
  "HL7": ["hl7", "java"],
  "File Server": ["nginx", "apache", "smbd", "vsftpd"],
  "Mobile Gateway": ["mobile", "java", "node"],
};

/**
 * Parse `ss -tulpn` output. Each line:
 *   tcp   LISTEN  0  4096  *:22  *:*  users:(("sshd",pid=900,fd=3))
 */
export function parseSs(stdout) {
  const rows = [];
  for (const raw of (stdout || "").split("\n")) {
    const line = raw.trim();
    if (!line || /^Netid|^State/i.test(line)) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 5) continue;
    const proto = cols[0].toLowerCase();
    const localAddr = cols[4] || "";
    const procField = (line.match(/users:\(\((.*)\)\)/) || [])[1] || "";
    const procs = [];
    for (const m of procField.matchAll(/"([^"]+)",pid=(\d+)/g)) {
      procs.push({ name: m[1], pid: Number(m[2]) });
    }
    const portMatch = localAddr.match(/:(\d+)$/);
    const port = portMatch ? Number(portMatch[1]) : null;
    rows.push({ proto, localAddr, port, procs });
  }
  return rows;
}

function expectedProcOk(service, procs) {
  const expected = ROLE_EXPECTED_PROC[service.role] || [];
  if (!expected.length) return null; // no expectation
  const names = procs.map((p) => (p.name || "").toLowerCase());
  return expected.some((kw) => names.some((n) => n.includes(kw)));
}

export async function collectPortTruthForService(service, expectedPorts = []) {
  const out = {
    serviceId: service.id,
    name: service.name,
    role: service.role,
    host: service.host,
    sshConnected: false,
    listening: [],
    expectedPorts,
    portChecks: [],
    issues: [],
    skipped: false,
    skipReason: null,
    raw: null,
  };
  if (!service.host || !service.username || !service.password) {
    out.skipped = true; out.skipReason = "ssh credentials not supplied"; return out;
  }
  const r = await remoteExec({ host: service.host, port: service.port || 22, username: service.username, password: service.password }, "ss -tulpn", 8_000);
  if (!r.ok) {
    out.skipped = true; out.skipReason = `${r.stage || "exec_error"}: ${r.error || ""}`.trim();
    out.issues.push({ kind: "ss_failed", detail: out.skipReason });
    out.raw = r;
    return out;
  }
  out.sshConnected = true;
  out.raw = r;
  out.listening = parseSs(r.stdout || "");

  const portsToCheck = Array.from(new Set([...COMMON_PORTS, ...expectedPorts.filter(Number.isFinite)]));
  for (const p of portsToCheck) {
    const matches = out.listening.filter((row) => row.port === p);
    const isExpected = expectedPorts.includes(p);
    if (matches.length === 0) {
      out.portChecks.push({ port: p, listening: false, owners: [], expected: isExpected, expectedProcOk: isExpected ? false : null });
      if (isExpected) out.issues.push({ kind: "expected_port_not_listening", detail: `Port ${p} not bound on ${service.host}` });
      continue;
    }
    const owners = matches.flatMap((m) => m.procs);
    const ok = isExpected ? expectedProcOk(service, owners) : null;
    out.portChecks.push({ port: p, listening: true, owners, expected: isExpected, expectedProcOk: ok });
    if (isExpected && ok === false) {
      const names = owners.map((o) => o.name).join(", ") || "(unknown)";
      out.issues.push({ kind: "wrong_process_owns_port", detail: `Port ${p} owned by [${names}] but expected ${service.role} process` });
    }
  }
  return out;
}

export async function collectPortTruth(services) {
  const out = [];
  for (const s of services) {
    // We pull expectedPorts from the matching ServiceEntry if present (none today)
    out.push(await collectPortTruthForService(s, []));
  }
  return { collectedAt: new Date().toISOString(), services: out };
}