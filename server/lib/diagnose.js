/**
 * Real diagnosis primitives — ping, DNS, TCP — using OS tools when available.
 * No fake results. If a tool isn't installed we say so honestly.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import dns from "node:dns/promises";

const COMMON_PORTS = [22, 80, 443, 8080, 10000, 161, 502, 1433, 3306];
const PORT_SERVICE = {
  22: "SSH", 80: "HTTP", 443: "HTTPS", 8080: "HTTP-alt",
  10000: "Webmin / Austco admin",
  161: "SNMP", 502: "Modbus", 1433: "MSSQL", 3306: "MySQL",
};

function execCapture(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", killed = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return resolve({ ok: false, code: -1, stdout: "", stderr: String(err?.message || err), missing: true });
    }
    const t = setTimeout(() => { killed = true; try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(t);
      // ENOENT => binary missing
      const missing = err && (err.code === "ENOENT");
      resolve({ ok: false, code: -1, stdout, stderr: stderr || String(err?.message || err), missing });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr, killed });
    });
  });
}

export async function pingHost(host) {
  // ping -c 3 -W 2 host
  const r = await execCapture("ping", ["-c", "3", "-W", "2", host], 10_000);
  if (r.missing) {
    return { performed: false, reachable: false, packetLossPct: null, avgLatencyMs: null, raw: "", error: "ping not installed on this VM" };
  }
  const out = r.stdout || "";
  // Parse "X% packet loss"
  const lossMatch = out.match(/(\d+(?:\.\d+)?)% packet loss/);
  const packetLossPct = lossMatch ? Number(lossMatch[1]) : null;
  // Parse rtt min/avg/max/mdev = 0.1/0.2/0.3/0.0 ms
  const rttMatch = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/);
  const avgLatencyMs = rttMatch ? Number(rttMatch[2]) : null;
  return {
    performed: true,
    reachable: r.ok && (packetLossPct == null || packetLossPct < 100),
    packetLossPct,
    avgLatencyMs,
    raw: out + (r.stderr ? `\n[stderr]\n${r.stderr}` : ""),
  };
}

export async function dnsLookup(hostname) {
  try {
    const records = await dns.lookup(hostname, { all: true });
    return { performed: true, resolved: records.map((r) => r.address), error: null };
  } catch (err) {
    return { performed: true, resolved: [], error: err?.code || err?.message || String(err) };
  }
}

export function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (open, error) => {
      if (done) return; done = true;
      try { socket.destroy(); } catch {}
      resolve({ open, latencyMs: open ? Date.now() - started : null, error: error || null });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (err) => finish(false, err?.code || err?.message || "error"));
    try { socket.connect(port, host); }
    catch (err) { finish(false, err?.message || "connect threw"); }
  });
}

async function probeDevice(d) {
  const ts = new Date().toISOString();
  const role = d.role || "Device";
  const name = d.name || role;

  // 1. DNS if hostname
  let dnsRes = { performed: false, resolved: [], error: null };
  let probeHost = (d.ip || "").trim();
  if ((d.hostname || "").trim()) {
    dnsRes = await dnsLookup(d.hostname.trim());
    if (!probeHost && dnsRes.resolved.length) probeHost = dnsRes.resolved[0];
  }

  if (!probeHost) {
    return {
      deviceId: d.id, name, role, ip: d.ip || "", hostname: d.hostname || "",
      ping: { performed: false, reachable: false, packetLossPct: null, avgLatencyMs: null, raw: "", error: null },
      dns: dnsRes,
      ports: [],
      status: "FAIL",
      message: dnsRes.performed
        ? `DNS lookup failed for ${d.hostname}`
        : `${role} has no IP or hostname configured`,
      timestamp: ts,
      source: "REAL TEST",
    };
  }

  // 2. ping
  const ping = await pingHost(probeHost);

  // 3. TCP ports — expectedPorts ∪ COMMON_PORTS
  const expected = Array.isArray(d.expectedPorts)
    ? d.expectedPorts.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 65536)
    : [];
  const ports = Array.from(new Set([...expected, ...COMMON_PORTS]));
  const portResults = await Promise.all(ports.map(async (p) => {
    const r = await tcpProbe(probeHost, p);
    return { port: p, open: r.open, service: PORT_SERVICE[p], latencyMs: r.latencyMs, error: r.error };
  }));

  // Decide status + message honestly
  const anyOpen = portResults.some((p) => p.open);
  const expectedOpen = expected.length === 0 ? true : portResults.filter((p) => expected.includes(p.port)).every((p) => p.open);

  let status, message;
  if (!ping.performed) {
    // ping binary missing — fall back to TCP
    if (anyOpen) { status = "PASS"; message = `Reachable via TCP at ${probeHost} — ${openSummary(portResults)} (ping not installed)`; }
    else { status = "FAIL"; message = `${role} unreachable at ${probeHost} (ping not installed; no TCP ports answered)`; }
  } else if (!ping.reachable && !anyOpen) {
    status = "FAIL"; message = `${role} unreachable at ${probeHost}`;
  } else if (ping.reachable && !anyOpen) {
    status = "WARN"; message = `Network reachable but expected services not responding.`;
  } else if (!expectedOpen) {
    status = "WARN";
    const missing = expected.filter((p) => !portResults.find((r) => r.port === p && r.open));
    message = `Reachable, but expected port${missing.length === 1 ? "" : "s"} ${missing.join(", ")} closed.`;
  } else {
    status = "PASS";
    message = `Reachable at ${probeHost} — ${openSummary(portResults)}`;
  }

  return {
    deviceId: d.id, name, role, ip: d.ip || "", hostname: d.hostname || "",
    ping, dns: dnsRes, ports: portResults, status, message,
    timestamp: ts, source: "REAL TEST",
  };
}

function openSummary(ports) {
  const open = ports.filter((p) => p.open);
  if (open.length === 0) return "no common ports open";
  return open.map((p) => `${p.port}${p.service ? `/${p.service}` : ""}`).join(", ");
}

export async function runDiagnosis(cfg, vm) {
  // Flatten config into testable devices.
  const flat = [
    ...(cfg.modules || []).map((m) => ({ id: m.id, name: m.name || m.role, role: m.role, ip: m.ip, hostname: m.hostname, expectedPorts: m.expectedPorts })),
    ...(cfg.controllers || []).map((c) => ({ id: c.id, name: c.name || `Controller ${c.controllerId || ""}`.trim(), role: "Controller", ip: c.ip, hostname: "", expectedPorts: c.expectedPorts })),
    ...(cfg.ipin8s || []).map((d) => ({ id: d.id, name: d.name || "IP-IN8", role: "IP-IN8", ip: d.ip, hostname: "", expectedPorts: d.expectedPorts })),
    ...(cfg.displays || []).map((d) => ({ id: d.id, name: d.name || "Display", role: "Display / IP-APP", ip: d.ip, hostname: "", expectedPorts: d.expectedPorts })),
    ...(cfg.switches || []).map((s) => ({ id: s.id, name: s.name || "Switch", role: "Switch", ip: s.ip, hostname: "", expectedPorts: s.expectedPorts })),
  ].filter((d) => (d.ip || "").trim() || (d.hostname || "").trim());

  if (flat.length === 0) {
    return {
      ok: false, reason: "insufficient_config",
      message: "Insufficient data — enter site IPs, hostnames, VLANs, or upload config before running diagnosis.",
    };
  }

  const startedAt = new Date().toISOString();
  const results = [];
  // Limited parallelism to avoid overwhelming the VM.
  const CONC = 5;
  for (let i = 0; i < flat.length; i += CONC) {
    const batch = flat.slice(i, i + CONC);
    const out = await Promise.all(batch.map(probeDevice));
    results.push(...out);
  }
  const finishedAt = new Date().toISOString();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    warn: results.filter((r) => r.status === "WARN").length,
    fail: results.filter((r) => r.status === "FAIL").length,
  };

  // Diagnosis verdict
  const breakAt = results.find((r) => r.status === "FAIL");
  const mode = "REAL TEST";
  const evidence = results.flatMap((r) => {
    const e = [`[${r.status}] ${r.name} (${r.role}) — ${r.message}`];
    if (r.ping.performed) e.push(`  ping ${r.ip || r.hostname}: ${r.ping.reachable ? "reachable" : "unreachable"}${r.ping.avgLatencyMs != null ? ` avg ${r.ping.avgLatencyMs}ms` : ""}${r.ping.packetLossPct != null ? ` loss ${r.ping.packetLossPct}%` : ""}`);
    return e;
  });
  const fixActions = breakAt
    ? [
        `Verify physical connectivity to ${breakAt.name} at ${breakAt.ip || breakAt.hostname}.`,
        `Check switch port and VLAN assignment for ${breakAt.role}.`,
        `Confirm ${breakAt.role} service is running and listening on the expected ports.`,
      ]
    : results.some((r) => r.status === "WARN")
      ? ["One or more services are reachable on the network but not answering on expected ports — check service health on the host."]
      : [];

  return {
    ok: true,
    mode,
    siteName: cfg.siteName || "Unnamed site",
    technician: cfg.technician || "",
    siteNotes: cfg.siteNotes || "",
    vm,
    startedAt,
    finishedAt,
    summary,
    breakFoundAt: breakAt ? { name: breakAt.name, role: breakAt.role, ip: breakAt.ip, hostname: breakAt.hostname } : null,
    confidence: results.length >= 3 ? "HIGH" : "MEDIUM",
    evidence,
    devices: results,
    traceSteps: results.map((r) => ({ id: r.deviceId, label: r.name, status: r.status, detail: r.message })),
    fixActions,
    warnings: results.filter((r) => r.status === "WARN").map((r) => `${r.name}: ${r.message}`),
  };
}
