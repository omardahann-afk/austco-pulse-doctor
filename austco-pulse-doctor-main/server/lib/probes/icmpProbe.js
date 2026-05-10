/**
 * Real ICMP ping probe.
 *
 * Uses the system `ping` binary via the existing safeExec sandbox. Returns
 * an evidence record (see evidence.js). Never throws — failure becomes
 * { ok: false, error }.
 *
 * Required CAP_NET_RAW on the host (set in deploy/tacera-doctor-backend.service).
 */
import { localExec, safeHost } from "../evidenceCollectors/safeExec.js";
import { makeEvidence } from "./evidence.js";

function parsePing(stdout) {
  const tx = stdout.match(/(\d+)\s+packets transmitted/);
  const rx = stdout.match(/(\d+)\s+received/);
  const loss = stdout.match(/([\d.]+)%\s+packet loss/);
  const rtt = stdout.match(/min\/avg\/max(?:\/m?dev)?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
  return {
    transmitted: tx ? Number(tx[1]) : null,
    received: rx ? Number(rx[1]) : null,
    packetLossPct: loss ? Number(loss[1]) : null,
    avgLatencyMs: rtt ? Number(rtt[2]) : null,
    minLatencyMs: rtt ? Number(rtt[1]) : null,
    maxLatencyMs: rtt ? Number(rtt[3]) : null,
  };
}

export async function icmpProbe(device, { count = 3, timeoutSec = 2 } = {}) {
  const startedAt = Date.now();
  const host = String(device?.host || "").trim();
  if (!host) {
    return makeEvidence({ protocol: "icmp", device, ok: false, error: "no host configured", startedAt });
  }
  try { safeHost(host); }
  catch (err) {
    return makeEvidence({ protocol: "icmp", device, ok: false, error: err.message, startedAt });
  }
  const r = await localExec("ping", ["-c", String(count), "-W", String(timeoutSec), host], (count + 1) * timeoutSec * 1000 + 2000);
  if (r.stage === "blocked" || r.stage === "spawn_error") {
    return makeEvidence({ protocol: "icmp", device, ok: false, error: r.error || r.stage, startedAt, raw: { command: r.command || null } });
  }
  const parsed = parsePing(r.stdout || "");
  const ok = r.ok && (parsed.received || 0) > 0;
  return makeEvidence({
    protocol: "icmp",
    device,
    ok,
    latencyMs: parsed.avgLatencyMs,
    raw: {
      command: r.command,
      exitCode: r.exitCode,
      stdout: r.stdout?.slice(0, 4000) || "",
      stderr: r.stderr?.slice(0, 1000) || "",
      ...parsed,
    },
    error: ok ? null : (r.stderr?.trim() || r.error || `received ${parsed.received || 0}/${parsed.transmitted || count}`),
    startedAt,
  });
}