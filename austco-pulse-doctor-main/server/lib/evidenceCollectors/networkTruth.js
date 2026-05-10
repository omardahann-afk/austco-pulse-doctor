/**
 * Network Truth collector.
 *
 * For each target host (services + devices), collect:
 *   - ping (count 3)
 *   - DNS lookup via getent
 *   - route used via ip route get
 *   - ARP entry via ip neigh show (filtered by IP)
 *   - source VM IP / interface used
 *   - TCP probe to expected ports
 *
 * All probes run from the diagnostic VM (the host running tacera-doctor).
 */
import { localExec, tcpProbe, localIfaces, safeHost } from "./safeExec.js";

function parsePingSummary(stdout) {
  // Linux iputils style:
  //   3 packets transmitted, 3 received, 0% packet loss, time 2002ms
  //   rtt min/avg/max/mdev = 0.123/0.456/0.789/0.111 ms
  const tx = stdout.match(/(\d+)\s+packets transmitted/);
  const rx = stdout.match(/(\d+)\s+received/);
  const loss = stdout.match(/([\d.]+)%\s+packet loss/);
  const rtt = stdout.match(/min\/avg\/max(?:\/m?dev)?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
  return {
    transmitted: tx ? Number(tx[1]) : null,
    received: rx ? Number(rx[1]) : null,
    packetLossPct: loss ? Number(loss[1]) : null,
    avgLatencyMs: rtt ? Number(rtt[2]) : null,
  };
}

function parseGetentHosts(stdout) {
  // "<ip>   name1 name2..."  one or more lines
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const ips = [];
  for (const l of lines) {
    const ip = l.split(/\s+/)[0];
    if (ip && !ips.includes(ip)) ips.push(ip);
  }
  return ips;
}

function parseIpRouteGet(stdout) {
  // e.g. "10.0.0.5 dev eth0 src 10.0.0.20 uid 1000"
  const dev = stdout.match(/\bdev\s+(\S+)/);
  const src = stdout.match(/\bsrc\s+(\S+)/);
  const via = stdout.match(/\bvia\s+(\S+)/);
  return { iface: dev ? dev[1] : null, srcIp: src ? src[1] : null, gateway: via ? via[1] : null };
}

function parseArpForIp(stdout, ip) {
  if (!ip) return null;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith(ip + " ") || t.startsWith(ip + "\t")) {
      const macMatch = t.match(/lladdr\s+([0-9a-f:]{17})/i);
      const stateMatch = t.match(/\b(REACHABLE|STALE|DELAY|PROBE|FAILED|INCOMPLETE|PERMANENT|NOARP)\b/);
      return { ip, mac: macMatch ? macMatch[1] : null, state: stateMatch ? stateMatch[1] : null, raw: t };
    }
  }
  return null;
}

/**
 * Collect network truth for a single target.
 * @param {{ id, name, role, host, hostname?, expectedPorts? }} target
 */
export async function collectNetworkTruthForTarget(target) {
  const probeHost = (target.host || target.hostname || "").trim();
  const dnsName = (target.hostname || "").trim();
  const expectedPorts = Array.isArray(target.expectedPorts) ? target.expectedPorts.filter(Number.isFinite) : [];

  const result = {
    targetId: target.id,
    name: target.name,
    role: target.role,
    host: probeHost,
    hostname: dnsName,
    ping: null,
    dns: null,
    route: null,
    arp: null,
    sourceIp: null,
    sourceIface: null,
    tcpChecks: [],
    summary: "",
    issues: [],
  };

  if (!probeHost) {
    result.summary = "no host configured";
    result.issues.push({ kind: "missing_host", detail: "Target has no host or hostname configured." });
    return result;
  }

  // Validate host before passing to any external tool.
  try { safeHost(probeHost); }
  catch (err) { result.summary = err.message; result.issues.push({ kind: "invalid_host", detail: err.message }); return result; }

  // Ping
  const ping = await localExec("ping", ["-c", "3", "-W", "2", probeHost], 9_000);
  if (ping.stage === "blocked") {
    result.ping = { performed: false, error: ping.error };
  } else {
    const parsed = parsePingSummary(ping.stdout || "");
    result.ping = {
      performed: true,
      reachable: ping.ok && (parsed.received || 0) > 0,
      ...parsed,
      error: ping.ok ? null : (ping.stderr?.trim() || ping.error || null),
    };
    if (!result.ping.reachable) result.issues.push({ kind: "ping_unreachable", detail: result.ping.error || "no reply" });
  }

  // DNS via getent (only if a hostname is configured)
  if (dnsName) {
    try { safeHost(dnsName); }
    catch (err) {
      result.dns = { performed: false, error: err.message, resolved: [] };
    }
    if (!result.dns) {
      const dns = await localExec("getent", ["hosts", dnsName], 5_000);
      const resolved = dns.ok ? parseGetentHosts(dns.stdout || "") : [];
      result.dns = {
        performed: true,
        resolved,
        error: dns.ok ? null : (dns.stderr?.trim() || dns.error || "lookup failed"),
      };
      if (dns.ok && resolved.length === 0) {
        result.issues.push({ kind: "dns_empty", detail: `getent returned no addresses for ${dnsName}` });
      } else if (!dns.ok) {
        result.issues.push({ kind: "dns_failed", detail: result.dns.error });
      } else if (probeHost && /^[0-9.]+$/.test(probeHost) && !resolved.includes(probeHost)) {
        result.issues.push({ kind: "dns_mismatch", detail: `${dnsName} resolves to [${resolved.join(", ")}] but configured host is ${probeHost}` });
      }
    }
  } else {
    result.dns = { performed: false, resolved: [], error: "no hostname configured" };
  }

  // Route
  const route = await localExec("ip", ["route", "get", probeHost], 5_000);
  if (route.ok) {
    const parsed = parseIpRouteGet(route.stdout || "");
    result.route = { performed: true, raw: (route.stdout || "").trim(), ...parsed, error: null };
    result.sourceIp = parsed.srcIp;
    result.sourceIface = parsed.iface;
  } else {
    result.route = { performed: true, raw: (route.stdout || "").trim(), iface: null, srcIp: null, gateway: null, error: route.stderr?.trim() || route.error || "route lookup failed" };
  }

  // ARP
  const arp = await localExec("ip", ["neigh", "show"], 5_000);
  if (arp.ok) {
    // ARP requires the target IP. If host is hostname, use first resolved address.
    const ip = /^[0-9.]+$/.test(probeHost) ? probeHost : (result.dns?.resolved?.[0] || null);
    const entry = ip ? parseArpForIp(arp.stdout || "", ip) : null;
    result.arp = { performed: true, ip, entry, error: null };
    if (ip && !entry) {
      result.issues.push({ kind: "arp_missing", detail: `No ARP entry for ${ip}` });
    }
    if (entry && entry.state === "FAILED") {
      result.issues.push({ kind: "arp_failed", detail: `ARP state FAILED for ${ip}` });
    }
  } else {
    result.arp = { performed: true, ip: null, entry: null, error: arp.stderr?.trim() || arp.error || "arp lookup failed" };
  }

  // TCP probes
  for (const p of expectedPorts) {
    const r = await tcpProbe(probeHost, p, 4_000);
    result.tcpChecks.push({ port: p, open: r.open, latencyMs: r.latencyMs, error: r.error });
    if (!r.open) result.issues.push({ kind: "port_closed", detail: `TCP ${probeHost}:${p} ${r.error || "closed"}` });
  }

  // Summary
  const reach = result.ping?.reachable;
  const portsOpen = result.tcpChecks.filter((c) => c.open).length;
  const portsTotal = result.tcpChecks.length;
  result.summary = reach
    ? `host reachable · ${portsOpen}/${portsTotal} expected ports open`
    : "host unreachable";
  return result;
}

export async function collectNetworkTruth(targets) {
  const out = [];
  for (const t of targets) {
    out.push(await collectNetworkTruthForTarget(t));
  }
  return { collectedAt: new Date().toISOString(), sourceVm: { interfaces: localIfaces() }, targets: out };
}