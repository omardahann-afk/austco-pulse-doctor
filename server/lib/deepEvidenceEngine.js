/**
 * Deep Evidence Engine — orchestrates the read-only collectors and runs
 * cross-source contradiction detection.
 *
 * Output shape (frozen for the UI / Autopilot / Trace consumers):
 *   { collectedAt, targets, networkTruth, processTruth, portTruth, mqttTruth,
 *     configTruth, stateTruth, contradictions, rootCauseSignals,
 *     traceSignals, evidenceScore }
 */
import { collectNetworkTruth } from "./evidenceCollectors/networkTruth.js";
import { collectProcessTruth } from "./evidenceCollectors/processTruth.js";
import { collectPortTruth } from "./evidenceCollectors/portTruth.js";
import { collectConfigTruth } from "./evidenceCollectors/configTruth.js";
import { getMqttSession, analyzeMqttEvents } from "./evidenceCollectors/mqttTruth.js";

/** Latest evidence cache (in-memory only — not persisted). */
let latestEvidence = null;

/** Build the target list from siteConfig.services + devices. */
function buildTargets(siteConfig = {}) {
  const targets = [];
  for (const s of (siteConfig.services || [])) {
    if (s.enabled === false) continue;
    if (!s.host && !s.hostname) continue;
    targets.push({
      kind: "service", id: s.id, name: s.name, role: s.role,
      host: s.host, hostname: s.hostname,
      expectedPorts: [22], // SSH at minimum; role-specific ports added below
    });
  }
  // Add role-specific expected app ports (best-effort).
  for (const t of targets) {
    if (t.role === "MQTT Broker") t.expectedPorts.push(1883);
    if (t.role === "WebSocket MQTT Adapter") t.expectedPorts.push(8081);
    if (t.role === "Pulse Manage") t.expectedPorts.push(10000); // webmin
    if (t.role === "License Service") t.expectedPorts.push(8080);
  }
  // Devices
  for (const m of (siteConfig.modules || [])) {
    if (!m.ip && !m.hostname) continue;
    targets.push({ kind: "module", id: m.id, name: m.name, role: m.role, host: m.ip, hostname: m.hostname, expectedPorts: m.expectedPorts || [] });
  }
  for (const c of (siteConfig.controllers || [])) {
    if (!c.ip) continue;
    targets.push({ kind: "controller", id: c.id, name: c.name, role: "Controller", host: c.ip, hostname: "", expectedPorts: c.expectedPorts || [] });
  }
  for (const d of (siteConfig.ipin8s || [])) {
    if (!d.ip) continue;
    targets.push({ kind: "ipin8", id: d.id, name: d.name, role: "IP-IN8", host: d.ip, hostname: "", expectedPorts: d.expectedPorts || [] });
  }
  return targets;
}

/* ===== Contradiction detection ===== */

function findNet(net, name) { return net?.targets?.find((t) => t.name === name) || null; }
function findProc(proc, name) { return proc?.services?.find((s) => s.name === name) || null; }
function findPort(port, name) { return port?.services?.find((s) => s.name === name) || null; }

function pushContradiction(list, c) {
  list.push({ confidence: 0.7, ...c });
}

function detectContradictions({ networkTruth, processTruth, portTruth, configTruth, mqttAnalysis, services, recentLogFindings }) {
  const out = [];

  // 1. Host reachable but expected port closed
  for (const t of networkTruth?.targets || []) {
    if (t.ping?.reachable) {
      const closed = (t.tcpChecks || []).filter((c) => !c.open && c.port !== 22);
      for (const c of closed) {
        pushContradiction(out, {
          kind: "host_reachable_port_closed",
          sourceA: { layer: "network", said: `Ping ${t.host} succeeded (${t.ping.avgLatencyMs ?? "?"}ms avg)` },
          sourceB: { layer: "network", said: `TCP ${t.host}:${c.port} closed (${c.error || "no listener"})` },
          why: "VM is alive but the application is not accepting connections on the expected port.",
          likelyLayer: "service",
          confidence: 0.9,
          target: t.name,
          nextCheck: `On ${t.name}: systemctl status / docker ps / ss -tulpn | grep ${c.port}`,
        });
      }
    }
  }

  // 2. DNS mismatch
  for (const t of networkTruth?.targets || []) {
    const issue = (t.issues || []).find((i) => i.kind === "dns_mismatch");
    if (issue) {
      pushContradiction(out, {
        kind: "dns_resolves_to_wrong_ip",
        sourceA: { layer: "config", said: `Site config says ${t.name} = ${t.host}` },
        sourceB: { layer: "dns", said: issue.detail },
        why: "Service traffic may go to the wrong host.",
        likelyLayer: "configuration",
        confidence: 0.85,
        target: t.name,
        nextCheck: `Reconcile DNS, /etc/hosts, and site config for ${t.hostname || t.name}`,
      });
    }
  }

  // 3. ARP sees MAC but ping fails (host present on L2, blocked above)
  for (const t of networkTruth?.targets || []) {
    if (t.arp?.entry?.mac && t.ping && !t.ping.reachable) {
      pushContradiction(out, {
        kind: "arp_present_ping_failed",
        sourceA: { layer: "network", said: `ARP knows ${t.arp.entry.ip} → ${t.arp.entry.mac}` },
        sourceB: { layer: "network", said: `ICMP ping to ${t.host} failed` },
        why: "L2 sees the host but L3 reachability is blocked — likely firewall, routing or NIC issue.",
        likelyLayer: "network",
        confidence: 0.8,
        target: t.name,
        nextCheck: `Check firewall/iptables on ${t.host}, or run traceroute from this VM`,
      });
    }
  }

  // 4. Wrong process owns expected port
  for (const ps of portTruth?.services || []) {
    for (const c of ps.portChecks || []) {
      if (c.expected && c.listening && c.expectedProcOk === false) {
        pushContradiction(out, {
          kind: "wrong_process_owns_port",
          sourceA: { layer: "config", said: `Expected ${ps.role} process owning port ${c.port}` },
          sourceB: { layer: "ports", said: `Port ${c.port} owned by [${(c.owners || []).map((o) => o.name).join(", ") || "?"}]` },
          why: "The expected service is not the one bound to its port.",
          likelyLayer: "service",
          confidence: 0.85,
          target: ps.name,
          nextCheck: `On ${ps.host}: systemctl status of competing process; verify config bind address`,
        });
      }
    }
  }

  // 5. Service running but expected port not bound
  for (const ps of portTruth?.services || []) {
    const proc = findProc(processTruth, ps.name);
    const isActive = proc?.isActive === "active";
    for (const c of ps.portChecks || []) {
      if (c.expected && !c.listening && isActive) {
        pushContradiction(out, {
          kind: "service_running_no_port",
          sourceA: { layer: "process", said: `${proc.unit} is active on ${ps.host}` },
          sourceB: { layer: "ports", said: `Port ${c.port} not bound on ${ps.host}` },
          why: "Service runs but isn't listening — config bind error or startup failure mid-init.",
          likelyLayer: "application",
          confidence: 0.8,
          target: ps.name,
          nextCheck: `journalctl -u ${proc.unit} -n 200 — look for bind/init errors`,
        });
      }
    }
  }

  // 6. Logs say offline but network/port say reachable
  for (const finding of recentLogFindings || []) {
    if (!/offline|unreachable|connection refused/i.test(finding.message || "")) continue;
    const targetName = finding.target;
    const net = findNet(networkTruth, targetName);
    if (net?.ping?.reachable) {
      pushContradiction(out, {
        kind: "logs_say_offline_but_reachable",
        sourceA: { layer: "logs", said: `${targetName}: ${finding.message}` },
        sourceB: { layer: "network", said: `Ping ${net.host} succeeds now` },
        why: "Log message may be stale or scoped to a specific port — host itself is reachable.",
        likelyLayer: "service",
        confidence: 0.7,
        target: targetName,
        nextCheck: `Check timestamp of log line vs current state; verify the specific port from the log message`,
      });
    }
  }

  // 7. CP appears in MQTT/logs but not in config
  if (configTruth?.unknownCpIds?.length) {
    pushContradiction(out, {
      kind: "cp_observed_not_configured",
      sourceA: { layer: "events", said: `Observed ${configTruth.unknownCpIds.length} CP IDs in live evidence` },
      sourceB: { layer: "config", said: `These CPs are not present in site config: ${configTruth.unknownCpIds.slice(0, 5).join(", ")}${configTruth.unknownCpIds.length > 5 ? "…" : ""}` },
      why: "Physical/logical devices exist on the wire but are not in the configuration model.",
      likelyLayer: "configuration",
      confidence: 0.8,
      nextCheck: "Sync site config with deployed CCP; add the missing CPs",
    });
  }

  // 8. INGA logs event but MQTT never sees it (or vice-versa)
  if (mqttAnalysis?.available) {
    const seenIds = new Set([
      ...mqttAnalysis.observedCpIds,
      ...Object.keys(mqttAnalysis.topicCounts || {}),
    ]);
    for (const f of recentLogFindings || []) {
      if (f.kind === "event_published" && f.eventId && !seenIds.has(f.eventId)) {
        pushContradiction(out, {
          kind: "log_event_missing_on_mqtt",
          sourceA: { layer: "logs", said: `INGA logged event ${f.eventId}` },
          sourceB: { layer: "mqtt", said: `Event ${f.eventId} not observed on MQTT during tap window` },
          why: "Break between INGA and the MQTT broker — or wrong topic / wrong broker.",
          likelyLayer: "integration",
          confidence: 0.85,
          nextCheck: "Verify MQTT broker host/topic in INGA config; check broker auth and ACLs",
        });
      }
    }
    if (mqttAnalysis.missingAcks?.length) {
      pushContradiction(out, {
        kind: "mqtt_publish_no_ack",
        sourceA: { layer: "mqtt", said: `${mqttAnalysis.missingAcks.length} events published without observed ACK` },
        sourceB: { layer: "downstream", said: `Configured ack topic '${mqttAnalysis.ackTopic}' produced no matching messages` },
        why: "Event reaches the broker but downstream integration never confirms receipt.",
        likelyLayer: "integration",
        confidence: 0.75,
        nextCheck: "Check downstream consumer (Connexall/Pulse Gateway) connectivity to broker",
      });
    }
  }

  return out;
}

/* ===== Evidence score (rough, 0–100) ===== */

function computeEvidenceScore({ networkTruth, processTruth, portTruth, mqttAnalysis }) {
  let total = 0, accumulated = 0;
  total += 20; if (networkTruth?.targets?.length) accumulated += 20;
  total += 25; if (processTruth?.services?.some((s) => s.sshConnected)) accumulated += 25;
  total += 25; if (portTruth?.services?.some((s) => s.sshConnected)) accumulated += 25;
  total += 15; if (mqttAnalysis?.available) accumulated += 15;
  total += 15; accumulated += 15; // config truth always available
  return Math.round((accumulated / total) * 100);
}

/* ===== Public API ===== */

export async function collectDeepEvidence({ siteConfig = {}, services = [], mqttSessionId = null, recentLogFindings = [] }) {
  const targets = buildTargets({ ...siteConfig, services: services.length ? services : siteConfig.services });
  const startedAt = new Date().toISOString();

  const networkTruth = await collectNetworkTruth(targets);
  // Process + Port require service password (never persisted, must be supplied per-call).
  const sshServices = (services || []).filter((s) => s.host && s.username && s.password);
  const processTruth = await collectProcessTruth(sshServices);
  const portTruth = await collectPortTruth(sshServices);

  const mqttSession = mqttSessionId ? getMqttSession(mqttSessionId) : null;
  const mqttAnalysis = mqttSession ? analyzeMqttEvents(mqttSession) : { available: false, reason: "no_session", message: "MQTT tap unavailable — credentials not configured." };

  const observedCpIds = mqttAnalysis.available ? mqttAnalysis.observedCpIds : [];
  const configTruth = collectConfigTruth({ siteConfig, networkTruth, observedCpIds });

  const stateTruth = { collectedAt: new Date().toISOString(), available: false, note: "State truth (DB/queue probes) requires service health endpoints — first pass surfaces only what process/port truth already reveals." };

  const contradictions = detectContradictions({ networkTruth, processTruth, portTruth, configTruth, mqttAnalysis, services: sshServices, recentLogFindings });

  const rootCauseSignals = contradictions
    .filter((c) => ["service", "application", "configuration", "integration"].includes(c.likelyLayer))
    .map((c) => ({ layer: c.likelyLayer, signal: c.kind, target: c.target || null, confidence: c.confidence, message: `${c.sourceA.said} vs ${c.sourceB.said}` }));

  const traceSignals = contradictions
    .filter((c) => ["log_event_missing_on_mqtt", "mqtt_publish_no_ack", "service_running_no_port", "host_reachable_port_closed"].includes(c.kind))
    .map((c) => ({ break: c.likelyLayer, kind: c.kind, target: c.target || null, evidence: [c.sourceA.said, c.sourceB.said] }));

  const evidenceScore = computeEvidenceScore({ networkTruth, processTruth, portTruth, mqttAnalysis });

  const result = {
    collectedAt: startedAt,
    finishedAt: new Date().toISOString(),
    targets: targets.map(({ id, name, role, host, hostname, kind }) => ({ id, name, role, host, hostname, kind })),
    networkTruth,
    processTruth,
    portTruth,
    mqttTruth: mqttAnalysis,
    configTruth,
    stateTruth,
    contradictions,
    rootCauseSignals,
    traceSignals,
    evidenceScore,
  };
  latestEvidence = result;
  return result;
}

export function getLatestEvidence() { return latestEvidence; }