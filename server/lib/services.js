/**
 * Service-level diagnosis: per-service ping → port 22 → SSH auth → SFTP log
 * pull → parse logs → aggregated diagnosis. No fake data, no fallbacks.
 */
import { pingHost, tcpProbe, dnsLookup } from "./diagnose.js";
import { testSshAuth, pullLogs } from "./ssh.js";
import { analyzeLogs } from "./logs.js";

function nowIso() { return new Date().toISOString(); }

async function resolveHost(svc) {
  let host = (svc.host || svc.ip || "").trim();
  let dns = { performed: false, resolved: [], error: null };
  if (!host && (svc.hostname || "").trim()) {
    dns = await dnsLookup(svc.hostname.trim());
    if (dns.resolved.length) host = dns.resolved[0];
  } else if ((svc.hostname || "").trim() && !/^[\d.]+$/.test(host)) {
    dns = await dnsLookup(svc.hostname.trim());
  }
  return { host, dns };
}

/** Run the full SSH/log pipeline for one enabled service. */
export async function diagnoseService(svc) {
  const startedAt = nowIso();
  const port = Number(svc.port) || 22;
  const out = {
    serviceId: svc.id,
    name: svc.name || svc.role || "Service",
    role: svc.role || "Service",
    host: "",
    hostname: svc.hostname || "",
    port,
    enabled: true,
    startedAt,
    finishedAt: null,
    steps: [],
    logs: [],
    parsed: null,
    status: "UNKNOWN",
    message: "",
    source: "REAL TEST",
  };

  const addStep = (name, status, detail) => out.steps.push({ name, status, detail, at: nowIso() });

  // 1. Resolve host
  const { host, dns } = await resolveHost(svc);
  out.host = host;
  if (!host) {
    out.status = "FAIL";
    out.message = `No IP/hostname configured for ${out.name}.`;
    addStep("resolve", "FAIL", out.message);
    out.finishedAt = nowIso();
    return out;
  }
  if (dns.performed) addStep("dns", dns.error ? "FAIL" : "PASS", dns.error || `Resolved to ${dns.resolved.join(", ")}`);

  // 2. Ping
  const ping = await pingHost(host);
  if (!ping.performed) addStep("ping", "WARN", "ping not installed on this VM — skipped");
  else addStep("ping", ping.reachable ? "PASS" : "FAIL",
    ping.reachable
      ? `${host} reachable${ping.avgLatencyMs != null ? ` (avg ${ping.avgLatencyMs}ms)` : ""}`
      : `${host} unreachable${ping.packetLossPct != null ? ` (loss ${ping.packetLossPct}%)` : ""}`);

  // 3. TCP port (SSH/SFTP)
  const portRes = await tcpProbe(host, port, 2500);
  addStep(`tcp:${port}`, portRes.open ? "PASS" : "FAIL",
    portRes.open ? `Port ${port} open (${portRes.latencyMs}ms)` : `Port ${port} closed/blocked: ${portRes.error || "no answer"}`);

  if (!portRes.open) {
    out.status = ping.performed && !ping.reachable ? "FAIL" : "FAIL";
    out.message = ping.performed && !ping.reachable
      ? `Network unreachable to ${host}.`
      : `SSH/SFTP port ${port} not available on ${host}.`;
    out.finishedAt = nowIso();
    return out;
  }

  // 4. SSH auth
  if (!svc.username) {
    out.status = "FAIL";
    out.message = "SSH username not provided.";
    addStep("ssh_auth", "FAIL", out.message);
    out.finishedAt = nowIso();
    return out;
  }
  const auth = await testSshAuth({ host, port, username: svc.username, password: svc.password || "" });
  if (!auth.ok) {
    addStep("ssh_auth", "FAIL", `${auth.stage}: ${auth.error}`);
    out.status = "FAIL";
    out.message = auth.stage === "auth_failed"
      ? `SSH authentication failed for ${svc.username}@${host}:${port}.`
      : `SSH connection failed (${auth.stage}): ${auth.error}`;
    out.finishedAt = nowIso();
    return out;
  }
  addStep("ssh_auth", "PASS", `Authenticated as ${svc.username}@${host}:${port}`);

  // 5. SFTP pull configured logs
  const paths = Array.isArray(svc.logPaths) ? svc.logPaths.filter((p) => String(p || "").trim()) : [];
  if (paths.length === 0) {
    out.status = "WARN";
    out.message = `Connected, but no log paths configured for ${out.name}.`;
    addStep("sftp_pull", "WARN", "No log paths to pull.");
    out.finishedAt = nowIso();
    return out;
  }

  const pull = await pullLogs({ host, port, username: svc.username, password: svc.password || "" }, paths);
  out.logs = pull.files || [];
  const okFiles = out.logs.filter((f) => f.ok);
  const notFound = out.logs.filter((f) => !f.ok && f.reason === "not_found").map((f) => f.path);
  const denied = out.logs.filter((f) => !f.ok && f.reason === "permission_denied").map((f) => f.path);
  const otherErr = out.logs.filter((f) => !f.ok && !["not_found","permission_denied"].includes(f.reason));

  addStep("sftp_pull",
    pull.ok && okFiles.length > 0 ? (notFound.length || denied.length ? "WARN" : "PASS") : "FAIL",
    pull.ok
      ? `Pulled ${okFiles.length}/${paths.length} log file(s)` +
        (notFound.length ? `; missing: ${notFound.join(", ")}` : "") +
        (denied.length ? `; permission denied: ${denied.join(", ")}` : "")
      : `SFTP failed (${pull.stage}): ${pull.error}`);

  if (okFiles.length === 0) {
    out.status = "FAIL";
    out.message = pull.ok
      ? `Connected but no log files could be read (${notFound.length} missing, ${denied.length} permission denied).`
      : `SFTP failed: ${pull.error}`;
    out.finishedAt = nowIso();
    return out;
  }

  // 6. Parse pulled logs
  const parseInput = okFiles.map((f) => ({ name: `${out.name}:${f.path.split("/").pop()}`, type: "auto", content: f.content }));
  const parsed = analyzeLogs(parseInput, { hostname: host, addrs: [], platform: "remote" });
  out.parsed = parsed;

  // Verdict from parsed evidence
  const counts = parsed.aggregate.eventCounts || {};
  const errs = parsed.aggregate.totalErrors || 0;
  if (counts.license_error) { out.status = "FAIL"; out.message = `License errors found in logs (${counts.license_error}).`; }
  else if (counts.heartbeat_fail) { out.status = "FAIL"; out.message = `Heartbeat failures in logs (${counts.heartbeat_fail}).`; }
  else if (counts.disconnect && counts.disconnect >= 3) { out.status = "WARN"; out.message = `Repeated disconnects (${counts.disconnect}).`; }
  else if (errs > 0) { out.status = "WARN"; out.message = `${errs} error line(s) found.`; }
  else { out.status = "PASS"; out.message = `Healthy — no errors in pulled logs.`; }

  if (notFound.length || denied.length) {
    out.status = out.status === "PASS" ? "WARN" : out.status;
    out.message += ` (${notFound.length + denied.length} log path issue(s))`;
  }

  out.finishedAt = nowIso();
  return out;
}

/** Run diagnosis on every enabled service. */
export async function runServiceDiagnosis(services, vm) {
  const enabled = (services || []).filter((s) => s && s.enabled !== false && (s.host || s.ip || s.hostname));
  if (enabled.length === 0) {
    return { ok: false, reason: "insufficient_config", message: "No enabled services with a host/IP. Enable at least one service and provide its IP/hostname." };
  }
  const startedAt = nowIso();
  const results = [];
  // Sequential to avoid hammering one VM with multiple SSH handshakes.
  for (const svc of enabled) {
    try { results.push(await diagnoseService(svc)); }
    catch (err) {
      results.push({
        serviceId: svc.id, name: svc.name || svc.role, role: svc.role, host: svc.host || svc.ip || "",
        port: svc.port || 22, status: "FAIL", message: `Agent error: ${err?.message || String(err)}`,
        steps: [], logs: [], parsed: null, source: "REAL TEST",
        startedAt, finishedAt: nowIso(),
      });
    }
  }
  const finishedAt = nowIso();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    warn: results.filter((r) => r.status === "WARN").length,
    fail: results.filter((r) => r.status === "FAIL").length,
  };
  const breakAt = results.find((r) => r.status === "FAIL") || null;
  const evidence = results.flatMap((r) => {
    const e = [`[${r.status}] ${r.name} (${r.role}) — ${r.message}`];
    for (const s of r.steps || []) e.push(`  · ${s.name}: ${s.status} — ${s.detail}`);
    return e;
  });

  return {
    ok: true,
    mode: "REAL TEST",
    vm,
    startedAt,
    finishedAt,
    summary,
    breakFoundAt: breakAt ? { name: breakAt.name, role: breakAt.role, host: breakAt.host } : null,
    confidence: results.length >= 2 ? "HIGH" : "MEDIUM",
    evidence,
    services: results,
  };
}
