/**
 * Evidence wrapper.
 *
 * Every probe MUST return an evidence record with this exact shape so the
 * UI / Autopilot / Root Cause engines can trust where a signal came from.
 * No guessed fields, no defaults that hide failure.
 *
 *   {
 *     source:    "agent-vm-hostname"      // who ran the probe
 *     timestamp: "2026-05-06T..."          // ISO string, when it ran
 *     protocol:  "icmp" | "tcp" | "https" | "mqtt"
 *     device:    { id, name?, host, port? }
 *     ok:        boolean
 *     latencyMs: number | null
 *     raw:       <protocol-specific structured payload>
 *     error:     string | null
 *     durationMs: number
 *   }
 */
import os from "node:os";

const VM_HOSTNAME = os.hostname();

export function makeEvidence({
  protocol,
  device,
  ok,
  latencyMs = null,
  raw = null,
  error = null,
  startedAt,
}) {
  const now = Date.now();
  return {
    source: VM_HOSTNAME,
    timestamp: new Date(now).toISOString(),
    protocol,
    device: {
      id: device?.id ?? null,
      name: device?.name ?? null,
      host: device?.host ?? null,
      port: device?.port ?? null,
    },
    ok: Boolean(ok),
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    raw,
    error: error || null,
    durationMs: startedAt ? now - startedAt : 0,
  };
}