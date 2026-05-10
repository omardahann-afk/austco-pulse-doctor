/**
 * Deterministic Austco/Tacera root-cause correlation engine.
 *
 * Inputs are evidence layers ONLY. No AI, no probabilistic scoring beyond
 * the explicit rules below. Output schema (see types/agentClient.ts):
 *
 *   {
 *     overallStatus,           // PASS | WARN | FAIL | INSUFFICIENT
 *     primaryRootCause,        // { title, layer, breakFoundAt, explanation }
 *     secondaryFindings: [],   // [{ title, layer, explanation }]
 *     ruledOutCauses:    [],   // ["Basic network is not the primary issue.", ...]
 *     breakFoundAt,            // string label (mirrors primaryRootCause.breakFoundAt)
 *     confidence,              // 0–100
 *     confidenceBreakdown:[],  // ["+25 ACTIVATE_TIMEOUT 4×", "+10 same CP repeats", ...]
 *     affectedServices:  [],
 *     affectedDevices:   [],
 *     affectedCallpoints:[],
 *     evidenceTimeline:  [],   // [{ ts, service, type, message }]
 *     evidenceByLayer:   {},   // { network: [...], access: [...], ... }
 *     fixActions:        [],
 *     escalationSummary,       // single paragraph for ticket
 *     developerSummary,        // technical multi-line summary, copyable
 *   }
 */

const LAYERS = ["network", "access", "service", "application", "configuration", "dependency"];

function flatFindings(serviceResults) {
  const all = [];
  for (const svc of serviceResults || []) {
    const svcName = svc.name || svc.role || "service";
    const svcRole = svc.role || "";
    for (const p of svc.parsedLogs || []) {
      if (!p?.ok || !Array.isArray(p.findings)) continue;
      for (const f of p.findings) {
        all.push({
          ...f,
          service: svcName,
          serviceRole: svcRole,
          path: p.path,
        });
      }
    }
  }
  return all;
}

function tally(findings, type) {
  return findings.filter((f) => f.type === type);
}

function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

function networkLayerEvidence(deviceResults, serviceResults) {
  const ev = [];
  const failed = [];
  for (const d of deviceResults || []) {
    if (d.ping?.performed && !d.ping.reachable) {
      failed.push(d);
      ev.push(`[device:${d.name}] ping ${d.ip || d.hostname} → unreachable (loss ${d.ping.packetLossPct ?? "?"}%)`);
    } else if (d.ping?.performed) {
      ev.push(`[device:${d.name}] ping ${d.ip || d.hostname} → reachable, avg ${d.ping.avgLatencyMs ?? "?"}ms`);
    }
  }
  for (const s of serviceResults || []) {
    const ping = (s.steps || []).find((st) => st.name === "ping");
    if (ping) ev.push(`[svc:${s.name}] ping → ${ping.status} — ${ping.detail}`);
  }
  return { evidence: ev, failed };
}

function accessLayerEvidence(serviceResults) {
  const ev = [];
  let allOk = true;
  let any = false;
  for (const s of serviceResults || []) {
    const tcp = (s.steps || []).find((st) => st.name?.startsWith("tcp:"));
    const auth = (s.steps || []).find((st) => st.name === "ssh_auth");
    const sftp = (s.steps || []).find((st) => st.name === "sftp_pull");
    if (tcp) { any = true; ev.push(`[svc:${s.name}] ${tcp.name} → ${tcp.status} — ${tcp.detail}`); if (tcp.status === "FAIL") allOk = false; }
    if (auth) { any = true; ev.push(`[svc:${s.name}] ssh_auth → ${auth.status} — ${auth.detail}`); if (auth.status === "FAIL") allOk = false; }
    if (sftp) { any = true; ev.push(`[svc:${s.name}] sftp_pull → ${sftp.status} — ${sftp.detail}`); if (sftp.status === "FAIL") allOk = false; }
  }
  return { evidence: ev, allOk: any && allOk, any };
}

function buildLayerBuckets(findings, deviceEv, accessEv) {
  const buckets = { network: [...deviceEv], access: [...accessEv], service: [], application: [], configuration: [], dependency: [] };
  for (const f of findings) {
    const line = `[${f.service}] ${f.timestamp || ""} ${f.type}: ${f.message}`;
    if (LAYERS.includes(f.layer)) buckets[f.layer].push(line);
    else buckets.service.push(line);
  }
  // Cap each bucket
  for (const k of Object.keys(buckets)) buckets[k] = buckets[k].slice(0, 25);
  return buckets;
}

function buildTimeline(findings) {
  return findings
    .filter((f) => f.timestamp)
    .slice(0, 30)
    .map((f) => ({ ts: f.timestamp, service: f.service, type: f.type, layer: f.layer, message: f.message, cpId: f.cpId || null }));
}

function devSummary(parts) {
  return parts.filter(Boolean).join("\n");
}

function pickPrimary(rules) {
  return rules.find(Boolean) || null;
}

/**
 * Main entry — runs all correlation rules in priority order and returns
 * the first matching primary root cause. Secondary findings are accumulated
 * from later-priority signals that did NOT win primary.
 */
export function buildRootCauseAnalysis({ siteConfig = {}, deviceResults = [], serviceResults = [], deepEvidence = null } = {}) {
  const findings = flatFindings(serviceResults);
  const net = networkLayerEvidence(deviceResults, serviceResults);
  const acc = accessLayerEvidence(serviceResults);

  const evidenceByLayer = buildLayerBuckets(findings, net.evidence, acc.evidence);
  const evidenceTimeline = buildTimeline(findings);

  const affectedServices = uniq([
    ...(serviceResults || []).filter((s) => s.status === "FAIL" || s.status === "WARN").map((s) => s.name),
    ...findings.map((f) => f.service),
  ]);
  const affectedDevices = uniq((deviceResults || []).filter((d) => d.status !== "PASS").map((d) => d.name));
  const affectedCallpoints = uniq(findings.flatMap((f) => [...(f.cpIds || []), f.invalidCpId]).filter(Boolean));

  const ruledOutCauses = [];
  const secondaryFindings = [];
  const confidenceBreakdown = [];

  // RULE A — Network ruled out
  const anyDeviceTested = (deviceResults || []).some((d) => d.ping?.performed);
  if (anyDeviceTested && net.failed.length === 0) {
    ruledOutCauses.push("Basic network reachability is not the primary issue (all tested hosts respond to ping and required ports).");
  }
  // RULE B — Access ruled out
  if (acc.any && acc.allOk) {
    ruledOutCauses.push("Server access and log retrieval are working (SSH, SFTP, log pull all PASS).");
  }
  // RULE C — Webmin closed but logs OK is only secondary
  for (const s of serviceResults || []) {
    const port10000 = (s.logs?.length ? false : false); // placeholder
    void port10000;
    const hasWebminClosed = (s.steps || []).some((st) => st.name === "tcp:10000" && st.status === "FAIL");
    const logsOk = (s.parsedLogs || []).some((p) => p.ok);
    if (hasWebminClosed && logsOk) {
      secondaryFindings.push({
        title: "Webmin (port 10000) unavailable",
        layer: "access",
        explanation: `Webmin is unreachable on ${s.name}, but service logs are still accessible — Webmin is not blocking diagnosis.`,
      });
    }
  }

  // === Primary root cause rules, evaluated in order. ===

  // Helper counts
  const activateTimeouts = tally(findings, "ACTIVATE_TIMEOUT");
  const cancelTimeouts = tally(findings, "CANCEL_TIMEOUT");
  const invalidCps = tally(findings, "INVALID_CALLPOINT");
  const invalidSigs = tally(findings, "INVALID_SIGNAL");
  const licenseErrs = tally(findings, "LICENSE_ERROR");
  const certErrs = [...tally(findings, "CERT_ERROR"), ...tally(findings, "TLS_ERROR")];
  const mqttDis = tally(findings, "MQTT_DISCONNECT");
  const wsErrs = tally(findings, "WEBSOCKET_ERROR");
  const eventQueue = tally(findings, "EVENT_QUEUE");
  const refused = tally(findings, "CONNECTION_REFUSED");

  // Repetition signals
  const cpFreq = new Map();
  for (const f of findings) for (const id of f.cpIds || []) cpFreq.set(id, (cpFreq.get(id) || 0) + 1);
  const repeatedCpIds = Array.from(cpFreq.entries()).filter(([, n]) => n >= 3).map(([id]) => id);
  const uniqueAffectedCps = affectedCallpoints.length;

  // Multi-service correlation: services with timeout/disconnect
  const svcWithTimeouts = uniq(activateTimeouts.concat(cancelTimeouts).concat(mqttDis).concat(wsErrs).map((f) => f.service));

  let primary = null;
  let confidence = 0;

  /* ===== DEEP EVIDENCE OVERRIDES (highest priority) =====
   * Deep Evidence (network/process/port/MQTT/config truth + contradictions)
   * is stronger than logs alone, so a matching contradiction wins over the
   * log-derived rules below.
   */
  const deepUsed = !!deepEvidence;
  const contradictionsUsed = [];
  const deepEvidenceSignals = [];
  if (deepUsed) {
    const contradictions = Array.isArray(deepEvidence.contradictions) ? deepEvidence.contradictions : [];
    // Map contradiction kind -> primary cause descriptor (in priority order).
    const KIND_PRIORITY = [
      "log_event_missing_on_mqtt",
      "mqtt_publish_no_ack",
      "config_unknown_cp_in_event",
      "cp_observed_not_configured",
      "service_running_no_port",
      "host_reachable_port_closed",
      "service_inactive_host_reachable",
    ];
    let chosen = null;
    for (const kind of KIND_PRIORITY) {
      const c = contradictions.find((x) => x.kind === kind);
      if (c) { chosen = c; break; }
    }
    if (chosen) {
      contradictionsUsed.push(chosen);
      switch (chosen.kind) {
        case "log_event_missing_on_mqtt":
          primary = {
            title: "Break between Integration Gateway and MQTT broker — event logged but never observed on the bus.",
            layer: "dependency",
            breakFoundAt: "INGA → MQTT broker / publish path",
            explanation: `${chosen.sourceA.said}, but ${chosen.sourceB.said}. The publish path from INGA to the broker is the failure point — verify broker host/topic/auth in INGA config.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
        case "mqtt_publish_no_ack":
          primary = {
            title: "Downstream integration did not acknowledge event published to MQTT.",
            layer: "dependency",
            breakFoundAt: "Downstream consumer (ACK path)",
            explanation: `${chosen.sourceA.said}; ${chosen.sourceB.said}. Broker is healthy — the failure is the downstream consumer that should ACK on '${deepEvidence.mqttTruth?.ackTopic || "ack topic"}'.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
        case "config_unknown_cp_in_event":
        case "cp_observed_not_configured":
          primary = {
            title: "Configuration mismatch — live event references CP not present in active config.",
            layer: "configuration",
            breakFoundAt: "Configuration / CCP",
            explanation: `${chosen.sourceA.said}; ${chosen.sourceB.said}. Reconcile CCP/site config with the IDs that are actually firing on the wire.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
        case "service_running_no_port":
          primary = {
            title: "Service process running but expected listener is not bound.",
            layer: "service",
            breakFoundAt: `Service listener${chosen.target ? ` (${chosen.target})` : ""}`,
            explanation: `${chosen.sourceA.said}; ${chosen.sourceB.said}. The process is alive but not bound to the expected port — check bind-address, config, and recent restart logs.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
        case "host_reachable_port_closed":
          primary = {
            title: "Application/service layer issue — host is reachable but service/port is failing.",
            layer: "service",
            breakFoundAt: `Service port closed${chosen.target ? ` (${chosen.target})` : ""}`,
            explanation: `${chosen.sourceA.said}, ${chosen.sourceB.said}. Do not call the host offline — the network layer is healthy. Investigate the service process, listener binding, or local firewall.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
        case "service_inactive_host_reachable":
          primary = {
            title: "Service stopped/inactive on reachable host.",
            layer: "service",
            breakFoundAt: `Service inactive${chosen.target ? ` (${chosen.target})` : ""}`,
            explanation: `${chosen.sourceA.said}, ${chosen.sourceB.said}. Host reachability is fine — the systemd/docker service itself is not running.`,
          };
          confidence = Math.round(chosen.confidence * 100);
          break;
      }
      if (primary) {
        confidenceBreakdown.push(`+${confidence} Deep Evidence contradiction "${chosen.kind}" (conf ${(chosen.confidence * 100).toFixed(0)}%) overrode log-only rules`);
      }
    }
    for (const s of (deepEvidence.rootCauseSignals || [])) {
      deepEvidenceSignals.push(s);
    }
  }

  // RULE J — License
  if (!primary && licenseErrs.length > 0) {
    confidence = licenseErrs.length >= 3 ? 92 : 80;
    confidenceBreakdown.push(`+${confidence} ${licenseErrs.length} LICENSE_ERROR line(s) across ${uniq(licenseErrs.map((f) => f.service)).length} service log(s)`);
    primary = {
      title: "License validation failure affecting service operation.",
      layer: "configuration",
      breakFoundAt: "License validation",
      explanation: `Logs contain ${licenseErrs.length} license validation failure(s). License must be valid for affected services to operate normally.`,
    };
  }
  // RULE K — Cert/TLS
  else if (certErrs.length > 0) {
    confidence = certErrs.length >= 3 ? 90 : 78;
    confidenceBreakdown.push(`+${confidence} ${certErrs.length} certificate/TLS error line(s)`);
    primary = {
      title: "Certificate / TLS failure affecting secure communication.",
      layer: "configuration",
      breakFoundAt: "Certificate / TLS",
      explanation: `Logs contain ${certErrs.length} certificate/TLS error(s). Secure channels (OpenVPN, MQTT-TLS, HTTPS) cannot establish until the chain is repaired.`,
    };
  }
  // RULE I — Multi-service messaging dependency (INGA + Pulse both failing)
  else if (svcWithTimeouts.length >= 2 && (activateTimeouts.length + mqttDis.length + wsErrs.length) >= 3) {
    confidence = 90;
    confidenceBreakdown.push(`+90 ${svcWithTimeouts.length} services show concurrent timeouts/disconnects`);
    primary = {
      title: "Shared messaging/dependency layer instability between Integration Gateway and Pulse Gateway.",
      layer: "dependency",
      breakFoundAt: "Messaging / dependency layer",
      explanation: `${svcWithTimeouts.length} services (${svcWithTimeouts.join(", ")}) report timeouts/disconnects in the same window. The shared dependency (broker, gateway, or message bus) is the most likely failure point.`,
    };
  }
  // RULE G — Many CP IDs with invalid signal (broad config mismatch)
  else if ((invalidCps.length + invalidSigs.length) > 0 && uniqueAffectedCps >= 10) {
    confidence = 90;
    confidenceBreakdown.push(`+90 ${uniqueAffectedCps} unique callpoints flagged as invalid (broad mismatch)`);
    primary = {
      title: "Broad configuration/signals mismatch, not a single device failure.",
      layer: "configuration",
      breakFoundAt: "Configuration / CCP / signal mapping",
      explanation: `${uniqueAffectedCps} different callpoint IDs are reported as invalid. This pattern indicates an imported/active CCP that does not match the live site, rather than a single bad device.`,
    };
  }
  // RULE F — Same CP id repeats in errors
  else if (repeatedCpIds.length > 0 && (activateTimeouts.length + invalidCps.length + invalidSigs.length) >= 3) {
    const cp = repeatedCpIds[0];
    confidence = 90;
    confidenceBreakdown.push(`+90 CP ${cp} repeats ≥3 times across ACTIVATE/INVALID errors`);
    primary = {
      title: "Specific callpoint/event source is repeatedly failing through Integration Gateway.",
      layer: "configuration",
      breakFoundAt: "Specific callpoint mapping",
      explanation: `Callpoint ${cp} repeats across ${cpFreq.get(cp)} error lines. Source device, controller mapping, or CCP entry for this CP needs verification.`,
    };
  }
  // RULE E — Repeated invalid CP / signal attributes
  else if (invalidCps.length + invalidSigs.length >= 1) {
    const total = invalidCps.length + invalidSigs.length;
    confidence = total >= 5 ? 88 : 80;
    confidenceBreakdown.push(`+${confidence} ${total} invalid callpoint/signal line(s)`);
    primary = {
      title: "Configuration mismatch: Integration Gateway is receiving callpoint/signal references not valid in current site configuration.",
      layer: "configuration",
      breakFoundAt: "Configuration / CCP / signal mapping",
      explanation: `${total} log line(s) report invalid callpoint or signal attributes. Most likely cause: stale or incorrect CCP/signal map vs. live site.`,
    };
  }
  // RULE D — INGA reachable but ACTIVATE_TIMEOUT in logs
  else if (activateTimeouts.length >= 1) {
    const within5min = activateTimeouts.length >= 3; // simplified — sample size as proxy for window density
    const cpId = activateTimeouts[0]?.cpId;
    const cpRepeats = cpId && cpFreq.get(cpId) >= 3;
    confidence = cpRepeats ? 95 : (within5min ? 85 : 75);
    confidenceBreakdown.push(`+${confidence} ${activateTimeouts.length} ACTIVATE_TIMEOUT event(s)${cpRepeats ? ` (CP ${cpId} repeats ${cpFreq.get(cpId)}×)` : ""}`);
    // RULE H — downstream suspicion when network/access layers are healthy
    const downstreamSuspect = net.failed.length === 0 && acc.allOk;
    primary = downstreamSuspect ? {
      title: "Integration Gateway is reachable, but downstream alarm activation dependency is not responding in time.",
      layer: "dependency",
      breakFoundAt: "Integration Gateway downstream dependency",
      explanation: `INGA is reachable and SSH/log access works, but ${activateTimeouts.length} ACTIVATE_TIMEOUT event(s) occurred. The break is downstream — Pulse Gateway, IPConnect, event queue, or message broker.`,
    } : {
      title: "Integration Gateway application path is timing out during alarm activation.",
      layer: "application",
      breakFoundAt: "Integration Gateway application/event layer",
      explanation: `${activateTimeouts.length} ACTIVATE_TIMEOUT event(s) detected in Integration Gateway logs.`,
    };
  }
  // RULE — event queue stalled
  else if (eventQueue.length > 0) {
    confidence = 85;
    confidenceBreakdown.push(`+85 event queue stop/halt detected`);
    primary = {
      title: "Event queue is stalled — events are not being processed.",
      layer: "application",
      breakFoundAt: "Event queue",
      explanation: `${eventQueue.length} event-queue stall line(s) detected. Service restart and downstream broker check required.`,
    };
  }
  // RULE — connection refused on a service
  else if (refused.length > 0) {
    confidence = refused.length >= 3 ? 85 : 70;
    confidenceBreakdown.push(`+${confidence} ${refused.length} CONNECTION_REFUSED line(s)`);
    primary = {
      title: "Service is reachable on the network but refusing connections.",
      layer: "service",
      breakFoundAt: "Application service",
      explanation: `Process likely down or not bound to the expected interface.`,
    };
  }
  // RULE — SSH/access layer broke (only when nothing higher matched)
  else if (acc.any && !acc.allOk) {
    confidence = 70;
    confidenceBreakdown.push(`+70 SSH/SFTP access failed on at least one service`);
    primary = {
      title: "Server reachable, but log access (SSH/SFTP) failed.",
      layer: "access",
      breakFoundAt: "Server access / SSH-SFTP",
      explanation: `Diagnosis cannot proceed past the access layer for affected services until SSH/SFTP works.`,
    };
  }
  // RULE — pure network failure (only when no service findings at all)
  else if (net.failed.length > 0) {
    confidence = net.failed.length >= 2 ? 90 : 70;
    confidenceBreakdown.push(`+${confidence} ${net.failed.length} device(s) failed ping from VM`);
    primary = {
      title: `${net.failed[0].name || net.failed[0].role} is unreachable from the diagnostic VM.`,
      layer: "network",
      breakFoundAt: "Network reachability",
      explanation: `${net.failed.length} target(s) failed basic ping. Check VLAN/routing and link state before deeper diagnosis.`,
    };
  }

  // RULE L — no fake root cause
  if (!primary) {
    confidence = 30;
    confidenceBreakdown.push("+30 only weak/no signals — refusing to invent a root cause");
    primary = {
      title: "Insufficient evidence for confirmed root cause.",
      layer: "service",
      breakFoundAt: "Insufficient evidence",
      explanation: "No deterministic correlation rule matched the available evidence. Pull additional logs (Pulse Gateway / IPConnect), monitor longer, or compare CCP before drawing conclusions.",
    };
  }

  /* Deep Evidence guard rule: if a log rule said "host offline" / "unreachable"
   * but Deep Evidence shows the host is reachable, soften the primary cause
   * so we never falsely report a host as offline. */
  if (deepUsed && primary && /unreachable|offline/i.test(primary.title)) {
    const reachableTargets = (deepEvidence.networkTruth?.targets || []).filter((t) => t?.ping?.ok);
    if (reachableTargets.length > 0) {
      contradictionsUsed.push({
        kind: "log_says_offline_network_says_reachable",
        sourceA: { layer: "logs", said: primary.title },
        sourceB: { layer: "network", said: `${reachableTargets.length} target(s) responded to ping` },
        why: "Logs reported offline/unreachable but Deep Evidence ping/ARP says the host is reachable.",
        likelyLayer: "service",
        confidence: 0.8,
      });
      primary = {
        title: "Application/service layer issue — host is reachable but expected service/port is unavailable.",
        layer: "service",
        breakFoundAt: "Service / port",
        explanation: `Logs suggested the device is offline, but Deep Evidence shows the host responds to ping. Investigate the service process and expected listener instead of network reachability.`,
      };
      confidenceBreakdown.push(`+10 Deep Evidence reclassified "offline" → service-layer issue (host reachable)`);
      confidence = Math.min(95, Math.max(confidence, 80));
    }
  }

  // Confidence boosters / reducers
  if (repeatedCpIds.length > 0 && primary.layer !== "network" && primary.layer !== "access") {
    confidenceBreakdown.push(`+5 ${repeatedCpIds.length} CP id(s) repeat ≥3×`);
    confidence = Math.min(98, confidence + 5);
  }
  if (svcWithTimeouts.length >= 2 && primary.layer !== "dependency") {
    confidenceBreakdown.push(`+5 multi-service correlation present`);
    confidence = Math.min(98, confidence + 5);
  }
  if (findings.length === 0 && primary.layer !== "network" && primary.layer !== "access") {
    confidenceBreakdown.push(`-15 no log findings to corroborate`);
    confidence = Math.max(20, confidence - 15);
  }

  // Secondary findings: anything that fired but did not become primary
  const addSecondary = (cond, item) => { if (cond) secondaryFindings.push(item); };
  addSecondary(primary.title.indexOf("License") < 0 && licenseErrs.length > 0, {
    title: "License errors also present", layer: "configuration",
    explanation: `${licenseErrs.length} license-related error line(s) detected.`,
  });
  addSecondary(primary.title.indexOf("Certificate") < 0 && certErrs.length > 0, {
    title: "Certificate/TLS errors also present", layer: "configuration",
    explanation: `${certErrs.length} certificate/TLS error line(s) detected.`,
  });
  addSecondary(primary.layer !== "dependency" && (mqttDis.length + wsErrs.length) > 0, {
    title: "Messaging layer noise (MQTT/WebSocket)", layer: "dependency",
    explanation: `${mqttDis.length} MQTT and ${wsErrs.length} WebSocket disconnect/error line(s) detected.`,
  });
  addSecondary(primary.title.indexOf("CANCEL") < 0 && cancelTimeouts.length > 0, {
    title: "CANCEL timeouts also detected", layer: "application",
    explanation: `${cancelTimeouts.length} CANCEL_TIMEOUT event(s) — alarm cancellation path may also be impacted.`,
  });

  // Fix actions per primary
  const fixActions = fixActionsFor(primary, { activateTimeouts, invalidCps, invalidSigs, licenseErrs, certErrs, repeatedCpIds, svcWithTimeouts });

  // Overall status
  const anyFail =
    (deviceResults || []).some((d) => d.status === "FAIL") ||
    (serviceResults || []).some((s) => s.status === "FAIL") ||
    findings.some((f) => f.severity === "ERROR");
  const anyWarn =
    (deviceResults || []).some((d) => d.status === "WARN") ||
    (serviceResults || []).some((s) => s.status === "WARN") ||
    findings.some((f) => f.severity === "WARN");
  const overallStatus = primary.breakFoundAt === "Insufficient evidence"
    ? "INSUFFICIENT"
    : anyFail ? "FAIL" : anyWarn ? "WARN" : "PASS";

  const escalationSummary =
    `${primary.title} Break found at: ${primary.breakFoundAt}. Confidence: ${confidence}%. ` +
    `Affected services: ${affectedServices.slice(0, 6).join(", ") || "none"}. ` +
    (affectedCallpoints.length ? `Affected callpoints: ${affectedCallpoints.slice(0, 6).join(", ")}${affectedCallpoints.length > 6 ? "…" : ""}.` : "");

  const developerSummary = devSummary([
    `## Root Cause Analysis`,
    `Primary: ${primary.title}`,
    `Layer:   ${primary.layer}`,
    `Break:   ${primary.breakFoundAt}`,
    `Confidence: ${confidence}%`,
    ``,
    `Confidence breakdown:`,
    ...confidenceBreakdown.map((c) => `  - ${c}`),
    ``,
    `Ruled out:`,
    ...(ruledOutCauses.length ? ruledOutCauses.map((c) => `  - ${c}`) : ["  (none)"]),
    ``,
    `Secondary findings:`,
    ...(secondaryFindings.length ? secondaryFindings.map((s) => `  - [${s.layer}] ${s.title}: ${s.explanation}`) : ["  (none)"]),
    ``,
    `Counts: ACTIVATE_TIMEOUT=${activateTimeouts.length} CANCEL_TIMEOUT=${cancelTimeouts.length} INVALID_CP=${invalidCps.length} INVALID_SIG=${invalidSigs.length} LICENSE=${licenseErrs.length} CERT/TLS=${certErrs.length} MQTT=${mqttDis.length} WS=${wsErrs.length} REFUSED=${refused.length} EVENT_QUEUE=${eventQueue.length}`,
    `Affected services: ${affectedServices.join(", ") || "(none)"}`,
    `Affected devices:  ${affectedDevices.join(", ") || "(none)"}`,
    `Affected CPs:      ${affectedCallpoints.join(", ") || "(none)"}`,
    repeatedCpIds.length ? `Repeated CPs (≥3): ${repeatedCpIds.join(", ")}` : "",
    ``,
    `Top evidence (timeline):`,
    ...evidenceTimeline.slice(0, 12).map((t) => `  ${t.ts} [${t.service}] ${t.type}${t.cpId ? ` cp=${t.cpId}` : ""} — ${t.message}`),
  ]);

  return {
    overallStatus,
    primaryRootCause: primary,
    breakFoundAt: primary.breakFoundAt,
    confidence,
    confidenceBreakdown,
    ruledOutCauses,
    secondaryFindings,
    affectedServices,
    affectedDevices,
    affectedCallpoints,
    evidenceTimeline,
    evidenceByLayer,
    fixActions,
    escalationSummary,
    developerSummary,
    deepEvidenceUsed: deepUsed,
    deepEvidenceSignals,
    contradictionsUsed,
    evidenceScore: deepUsed ? (deepEvidence.evidenceScore ?? 0) : 0,
  };
}

function fixActionsFor(primary, c) {
  switch (primary.breakFoundAt) {
    case "License validation":
      return [
        "Verify license status on the License Service VM.",
        "Check license expiry, seat count, and signing chain.",
        "Restart license service after capturing current state, then re-run diagnosis.",
      ];
    case "Certificate / TLS":
      return [
        "Check certificate expiry and CA chain on the affected service host.",
        "Validate OpenVPN / Pulse / MQTT TLS material and paths.",
        "Renew or replace the certificate, then restart the dependent service.",
      ];
    case "Messaging / dependency layer":
      return [
        "Check MQTT broker status and recent broker-side disconnects.",
        "Verify WebSocket-MQTT adapter is healthy and bound.",
        "Inspect Pulse Gateway ↔ Integration Gateway link in the same time window.",
      ];
    case "Configuration / CCP / signal mapping":
      return [
        "Compare the active CCP/site config to the live site (recent import?).",
        "Verify each invalid callpoint/signal exists in IPConnect CCP and is mapped.",
        "Roll back recent CCP import if the mismatch began after deployment.",
      ];
    case "Specific callpoint mapping":
      return [
        `Verify CP ${c.repeatedCpIds?.[0] || "(see evidence)"} in IPConnect CCP.`,
        "Check the controller and source device for that callpoint.",
        "Test the device hardware and signal path end-to-end.",
      ];
    case "Integration Gateway downstream dependency":
      return [
        "INGA itself is reachable — do NOT restart INGA first.",
        "Check Pulse Gateway and IPConnect health and recent restarts.",
        "Inspect message broker / event queue for backpressure or stop conditions.",
      ];
    case "Integration Gateway application/event layer":
      return [
        "Check Integration Gateway service status and recent restarts.",
        "Inspect ACTIVATE handler and event queue depth.",
        "Validate downstream activation dependency (Pulse Gateway / controller).",
      ];
    case "Event queue":
      return [
        "Capture event queue state, then restart the consuming service.",
        "Check broker availability — a stalled queue often points upstream.",
      ];
    case "Application service":
      return [
        "Confirm the service process is running and bound to the expected interface.",
        "Check local firewall and bind-address configuration.",
      ];
    case "Server access / SSH-SFTP":
      return [
        "Verify SSH service is running on the affected host.",
        "Verify tech credentials; confirm host firewall allows SSH from the diagnostic VM.",
      ];
    case "Network reachability":
      return [
        "Confirm IP/VLAN assignment for the unreachable host.",
        "Check switch port and link state.",
      ];
    default:
      return [
        "Pull additional logs (Pulse Gateway, IPConnect) and re-run diagnosis.",
        "Compare current CCP to the last known-good config.",
      ];
  }
}
