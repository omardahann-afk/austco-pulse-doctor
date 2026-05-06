/**
 * Real TCP port probe — pure node net, no shell. Wraps safeExec.tcpProbe
 * and returns a standard evidence record.
 */
import { tcpProbe as rawTcpProbe } from "../evidenceCollectors/safeExec.js";
import { makeEvidence } from "./evidence.js";

export async function tcpProbe(device, { timeoutMs = 4000 } = {}) {
  const startedAt = Date.now();
  const host = String(device?.host || "").trim();
  const port = Number(device?.port);
  if (!host || !Number.isInteger(port)) {
    return makeEvidence({ protocol: "tcp", device, ok: false, error: "host and port required", startedAt });
  }
  const r = await rawTcpProbe(host, port, timeoutMs);
  return makeEvidence({
    protocol: "tcp",
    device,
    ok: r.open,
    latencyMs: r.latencyMs,
    raw: { open: r.open, latencyMs: r.latencyMs, error: r.error || null, timeoutMs },
    error: r.open ? null : (r.error || "closed"),
    startedAt,
  });
}