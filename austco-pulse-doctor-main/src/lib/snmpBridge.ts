/**
 * SNMP Bridge Client
 * ------------------
 * Cloudflare Workers cannot speak SNMP/UDP. This module talks to a stub
 * server route at `/api/public/snmp-bridge` which itself either:
 *   - forwards to an external Node bridge (set `SNMP_BRIDGE_URL` secret), or
 *   - returns 501 with `unavailableReason` so the UI can degrade gracefully.
 *
 * Either way, the engine never invents SNMP data — failure paths return
 * EMPTY_SNMP and the no-hallucination guard in networkDoctor keeps the
 * top-level priority order honest.
 */

import type { SwitchInput } from "./siteDoctorApi";
import { EMPTY_SNMP, type SnmpPollResult } from "./networkDoctor";

export type SnmpPollRequest = {
  switches: SwitchInput[];
  /** Optional: known device IPs to feed into ARP enrichment. */
  arpHints?: string[];
};

/**
 * Poll SNMP via the server-side bridge. Always resolves — never throws.
 * Returns EMPTY_SNMP with a populated `unavailableReason` on any failure.
 */
export async function pollSnmp(req: SnmpPollRequest): Promise<SnmpPollResult> {
  if (!req.switches?.length) return EMPTY_SNMP;
  const enabled = req.switches.filter((s) => s.snmpEnabled);
  if (enabled.length === 0) {
    return { ...EMPTY_SNMP, unavailableReason: "no_snmp_enabled" };
  }
  try {
    const res = await fetch("/api/public/snmp-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ switches: enabled, arpHints: req.arpHints ?? [] }),
    });
    if (res.status === 501) {
      const body = await safeJson(res);
      return { ...EMPTY_SNMP, unavailableReason: body?.reason ?? "bridge_not_configured" };
    }
    if (!res.ok) {
      return { ...EMPTY_SNMP, unavailableReason: `bridge_http_${res.status}` };
    }
    const body = (await res.json()) as SnmpPollResult;
    if (!body || typeof body !== "object" || !Array.isArray(body.switches)) {
      return { ...EMPTY_SNMP, unavailableReason: "bridge_bad_response" };
    }
    return { ...body, ok: true };
  } catch (err) {
    return { ...EMPTY_SNMP, unavailableReason: err instanceof Error ? err.message : "bridge_error" };
  }
}

async function safeJson(res: Response): Promise<{ reason?: string } | null> {
  try { return await res.json(); } catch { return null; }
}