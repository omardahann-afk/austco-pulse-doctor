/**
 * POST /api/diagnosis
 * -------------------
 * Runs REAL network tests against the site config provided in the request body.
 * No defaults. No fake IPs. No demo data. If the payload contains zero
 * testable devices, returns 400 with "insufficient_config".
 *
 * Tests performed per device:
 *   - DNS lookup (if hostname provided)
 *   - TCP connect to common ports (treated as "ping + service probe")
 *   - Latency on the first successful TCP connect
 *
 * Note: Cloudflare Workers cannot send ICMP. We use TCP connect to common
 * service ports as a reachability + latency probe — this is the standard
 * pattern for edge runtimes and is honest "REAL TEST" behaviour.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { connect } from "cloudflare:sockets";

const ModuleSchema = z.object({
  id: z.string(),
  role: z.string().min(1).max(64),
  name: z.string().max(120).default(""),
  ip: z.string().max(45).default(""),
  hostname: z.string().max(253).default(""),
  vlan: z.string().max(64).default(""),
  notes: z.string().max(500).default(""),
});

const ControllerSchema = z.object({
  id: z.string(),
  name: z.string().max(120).default(""),
  ip: z.string().max(45).default(""),
  controllerId: z.string().max(64).default(""),
  area: z.string().max(120).default(""),
  notes: z.string().max(500).default(""),
});

const IpIn8Schema = z.object({
  id: z.string(),
  name: z.string().max(120).default(""),
  ip: z.string().max(45).default(""),
  vlan: z.string().max(64).default(""),
  notes: z.string().max(500).default(""),
});

const SwitchSchema = z.object({
  id: z.string(),
  name: z.string().max(120).default(""),
  ip: z.string().max(45).default(""),
  vendor: z.string().max(64).default(""),
  snmpEnabled: z.boolean().default(false),
  community: z.string().max(120).default(""),
  notes: z.string().max(500).default(""),
});

const VlanSchema = z.object({
  id: z.string(),
  name: z.string().max(64),
  cidr: z.string().max(64),
});

const RequestSchema = z.object({
  siteName: z.string().max(200).default(""),
  vlans: z.array(VlanSchema).max(64).default([]),
  modules: z.array(ModuleSchema).max(64).default([]),
  controllers: z.array(ControllerSchema).max(256).default([]),
  ipin8s: z.array(IpIn8Schema).max(256).default([]),
  switches: z.array(SwitchSchema).max(64).default([]),
  displaysEnabled: z.boolean().default(false),
});

const COMMON_PORTS = [22, 80, 443, 8080, 10000, 161, 502, 1433, 3306];
const PORT_SERVICE: Record<number, string> = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS",
  8080: "HTTP-alt",
  10000: "Webmin / Austco admin",
  161: "SNMP",
  502: "Modbus",
  1433: "MSSQL",
  3306: "MySQL",
};

const TCP_TIMEOUT_MS = 1500;

type PortResult = { port: number; open: boolean; service?: string; error?: string };

async function tcpProbe(host: string, port: number): Promise<{ open: boolean; latencyMs: number | null; error?: string }> {
  const started = Date.now();
  try {
    // cloudflare:sockets connect with TLS off; tiny write+close to confirm reachability.
    const socket = connect({ hostname: host, port }, { allowHalfOpen: false, secureTransport: "off" });
    const writer = socket.writable.getWriter();
    const racer = new Promise<{ open: boolean }>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), TCP_TIMEOUT_MS);
    });
    await Promise.race([writer.ready, racer]);
    const latencyMs = Date.now() - started;
    try { writer.releaseLock(); } catch {}
    try { await socket.close(); } catch {}
    return { open: true, latencyMs };
  } catch (err) {
    return { open: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function dnsLookup(hostname: string): Promise<{ resolved: string | null; error?: string }> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) return { resolved: null, error: `DNS HTTP ${res.status}` };
    const j = (await res.json()) as { Answer?: { data: string; type: number }[]; Status?: number };
    const ans = (j.Answer ?? []).find((a) => a.type === 1);
    if (!ans) return { resolved: null, error: j.Status === 3 ? "NXDOMAIN" : "no A record" };
    return { resolved: ans.data };
  } catch (err) {
    return { resolved: null, error: err instanceof Error ? err.message : String(err) };
  }
}

type FlatDevice = { deviceId: string; name: string; role: string; ip: string; hostname: string };

async function runDeviceTest(d: FlatDevice): Promise<DeviceResult> {
  const ts = new Date().toISOString();
  let dnsRes: { performed: boolean; resolved: string | null; error?: string } = { performed: false, resolved: null };
  let probeHost = d.ip.trim();

  if (d.hostname.trim()) {
    const r = await dnsLookup(d.hostname.trim());
    dnsRes = { performed: true, resolved: r.resolved, error: r.error };
    if (!probeHost && r.resolved) probeHost = r.resolved;
  }

  if (!probeHost) {
    return {
      deviceId: d.deviceId, name: d.name, role: d.role, ip: d.ip, hostname: d.hostname,
      ping: { performed: false, alive: false, latencyMs: null },
      dns: dnsRes,
      ports: [],
      status: "FAIL",
      message: dnsRes.performed
        ? `DNS lookup failed for ${d.hostname}`
        : `${d.role || "Device"} has no IP or hostname configured`,
      timestamp: ts,
      source: "REAL TEST",
    };
  }

  // Probe ports in parallel
  const portResults: PortResult[] = await Promise.all(
    COMMON_PORTS.map(async (p) => {
      const r = await tcpProbe(probeHost, p);
      return { port: p, open: r.open, service: PORT_SERVICE[p], error: r.error };
    }),
  );

  const anyOpen = portResults.some((p) => p.open);
  const firstOpen = portResults.find((p) => p.open);
  const latencyMs = firstOpen ? (await tcpProbe(probeHost, firstOpen.port)).latencyMs : null;

  let status: DeviceResult["status"];
  let message: string;
  if (anyOpen) {
    status = "PASS";
    message = `Reachable at ${probeHost} — ${portResults.filter((p) => p.open).map((p) => `${p.port}${p.service ? ` (${p.service})` : ""}`).join(", ")}`;
  } else {
    status = "FAIL";
    // distinguish DNS failure vs unreachable
    if (d.hostname.trim() && !dnsRes.resolved) {
      message = `DNS lookup failed for ${d.hostname}`;
    } else {
      message = `${d.role || d.name || "Device"} unreachable at ${probeHost}`;
    }
  }

  return {
    deviceId: d.deviceId, name: d.name, role: d.role, ip: d.ip, hostname: d.hostname,
    ping: { performed: true, alive: anyOpen, latencyMs },
    dns: dnsRes,
    ports: portResults,
    status,
    message,
    timestamp: ts,
    source: "REAL TEST",
  };
}

type DeviceResult = {
  deviceId: string; name: string; role: string; ip: string; hostname: string;
  ping: { performed: boolean; alive: boolean; latencyMs: number | null; error?: string };
  dns: { performed: boolean; resolved: string | null; error?: string };
  ports: PortResult[];
  status: "PASS" | "FAIL" | "WARN" | "UNKNOWN";
  message: string;
  timestamp: string;
  source: "REAL TEST";
};

export const Route = createFileRoute("/api/diagnosis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try { body = await request.json(); }
        catch { return Response.json({ ok: false, reason: "invalid_json", message: "Body must be JSON." }, { status: 400 }); }

        const parsed = RequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { ok: false, reason: "invalid_request", message: "Site config payload failed validation.", details: parsed.error.issues.slice(0, 5) },
            { status: 400 },
          );
        }
        const cfg = parsed.data;

        // Flatten into a single test list — preserves role labels.
        const devices: FlatDevice[] = [
          ...cfg.modules.map((m) => ({ deviceId: m.id, name: m.name || m.role, role: m.role, ip: m.ip, hostname: m.hostname })),
          ...cfg.controllers.map((c) => ({ deviceId: c.id, name: c.name || `Controller ${c.controllerId}`.trim(), role: "Controller", ip: c.ip, hostname: "" })),
          ...cfg.ipin8s.map((d) => ({ deviceId: d.id, name: d.name || "IP-IN8", role: "IP-IN8", ip: d.ip, hostname: "" })),
          ...cfg.switches.map((s) => ({ deviceId: s.id, name: s.name || "Switch", role: "Switch", ip: s.ip, hostname: "" })),
        ].filter((d) => d.ip.trim() || d.hostname.trim());

        if (devices.length === 0) {
          return Response.json(
            {
              ok: false,
              reason: "insufficient_config",
              message: "Insufficient data — enter site IPs, hostnames, VLANs, or upload config before running diagnosis.",
            },
            { status: 400 },
          );
        }

        const startedAt = new Date().toISOString();
        // Run with limited concurrency to avoid Worker subrequest spikes.
        const results: DeviceResult[] = [];
        const CONCURRENCY = 6;
        for (let i = 0; i < devices.length; i += CONCURRENCY) {
          const batch = devices.slice(i, i + CONCURRENCY);
          const out = await Promise.all(batch.map(runDeviceTest));
          results.push(...out);
        }
        const finishedAt = new Date().toISOString();

        const summary = {
          total: results.length,
          pass: results.filter((r) => r.status === "PASS").length,
          warn: results.filter((r) => r.status === "WARN").length,
          fail: results.filter((r) => r.status === "FAIL").length,
          unknown: results.filter((r) => r.status === "UNKNOWN").length,
        };

        return Response.json({
          ok: true,
          siteName: cfg.siteName || "Unnamed site",
          startedAt,
          finishedAt,
          results,
          summary,
        });
      },
    },
  },
});
