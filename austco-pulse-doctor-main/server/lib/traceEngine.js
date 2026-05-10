/**
 * Tacera Doctor — Trace Signal Path Engine
 * ----------------------------------------
 * Deterministic event/signal propagation tracer for Austco/Tacera stacks.
 * Walks: Input → Controller → IPConnect → Pulse Gateway → Integration Gateway
 *      → MQTT Broker → WebSocket MQTT Adapter → Display / IP-APP → External
 *
 * Inputs: { target, siteConfig, serviceResults, deviceResults }
 * Output: see TraceResult type in src/lib/agentClient.ts.
 *
 * Hard rules:
 *   - No fabricated propagation. Layers without evidence are NO_EVIDENCE.
 *   - Reachability + log evidence + site-config awareness are correlated.
 *   - MQTT/Connexall live tap not configured → marked honestly, not faked.
 */

const LAYER_ORDER = [
  "Input",
  "Controller",
  "IPConnect",
  "Pulse Gateway",
  "Integration Gateway",
  "MQTT Broker",
  "WebSocket MQTT Adapter",
  "Display / IP-APP",
  "External Systems",
];

const ROLE_TO_LAYER = {
  "IPConnect": "IPConnect",
  "Pulse Gateway": "Pulse Gateway",
  "Integration Gateway": "Integration Gateway",
  "MQTT Broker": "MQTT Broker",
  "WebSocket MQTT Adapter": "WebSocket MQTT Adapter",
  "Mobile Gateway": "External Systems",
  "HL7": "External Systems",
  "RTLS Gateway": "External Systems",
  "File Server": "External Systems",
  "Pulse Manage": null,
  "License Service": null,
};

function nowIso() { return new Date().toISOString(); }

/* ---------------- Target normalization ---------------- */

function targetLabel(t) {
  switch (t.kind) {
    case "cpId": return `CP ${t.value}`;
    case "room": return `Room ${t.value}`;
    case "fqLocation": return t.fqLocation || t.value;
    case "callType": return `${t.callType || t.value}${t.fqLocation ? ` @ ${t.fqLocation}` : ""}`;
    case "mqtt": return `MQTT ${t.mqttTopic || t.value}`;
    case "controllerId": return `Controller ${t.value}`;
    default: return t.value || "(no target)";
  }
}

function normalizeTarget(target) {
  const t = target || {};
  return {
    kind: t.kind || "auto",
    value: String(t.value || "").trim(),
    callType: String(t.callType || "").trim(),
    fqLocation: String(t.fqLocation || "").trim(),
    mqttTopic: String(t.mqttTopic || "").trim(),
    sinceMs: Number(t.sinceMs) > 0 ? Number(t.sinceMs) : 0,
    label: targetLabel({
      kind: t.kind || "auto",
      value: String(t.value || "").trim(),
      callType: t.callType,
      fqLocation: t.fqLocation,
      mqttTopic: t.mqttTopic,
    }),
  };
}

/* ---------------- Finding matching ---------------- */

function findingMatchesTarget(f, target) {
  if (!f) return false;
  const v = (target.value || "").toLowerCase();
  const fq = (target.fqLocation || "").toLowerCase();
  const ct = (target.callType || "").toLowerCase();
  const topic = (target.mqttTopic || "").toLowerCase();

  const ids = [...(f.cpIds || []), f.cpId, f.invalidCpId].filter(Boolean).map(String);
  const fqLoc = (f.fqLocation || "").toLowerCase();
  const msgLower = `${f.message || ""} ${f.raw || ""}`.toLowerCase();

  switch (target.kind) {
    case "cpId":
      if (!v) return false;
      return ids.some((id) => id.toLowerCase() === v || id.toLowerCase().includes(v));
    case "room":
      if (!v) return false;
      return msgLower.includes(`room ${v}`) || msgLower.includes(`rm ${v}`) || msgLower.includes(`/${v}/`) || fqLoc.includes(v);
    case "fqLocation":
      if (!fq) return false;
      return fqLoc.includes(fq) || msgLower.includes(fq);
    case "callType":
      if (!ct && !v) return false;
      return msgLower.includes(ct || v);
    case "mqtt":
      if (!topic) return false;
      return msgLower.includes(topic);
    case "controllerId":
      if (!v) return false;
      return msgLower.includes(`controller ${v}`) || msgLower.includes(v);
    case "auto":
    default:
      if (!v) return false;
      return ids.some((id) => id.toLowerCase().includes(v)) || msgLower.includes(v) || fqLoc.includes(v);
  }
}

/* ---------------- Site config awareness ---------------- */

function findCpInSiteConfig(target, siteConfig) {
  if (!siteConfig) return null;
  const v = (target.value || "").trim().toLowerCase();
  if (!v) return null;
  const buckets = [
    ...(siteConfig.modules || []).map((m) => ({ ...m, kind: "module" })),
    ...(siteConfig.controllers || []).map((c) => ({ ...c, kind: "controller", _id: c.controllerId })),
    ...(siteConfig.ipin8s || []).map((d) => ({ ...d, kind: "ipin8" })),
    ...(siteConfig.displays || []).map((d) => ({ ...d, kind: "display" })),
  ];
  for (const b of buckets) {
    const candidates = [b.id, b.name, b.ip, b.hostname, b._id].filter(Boolean).map(String);
    if (candidates.some((c) => c.toLowerCase() === v || c.toLowerCase().includes(v))) {
      return b;
    }
  }
  return null;
}

/* ---------------- Evidence aggregation ---------------- */

function flatFindings(serviceResults) {
  const out = [];
  for (const svc of serviceResults || []) {
    const layer = ROLE_TO_LAYER[svc.role] || svc.role || "Service";
    for (const p of svc.parsedLogs || []) {
      if (!p?.ok || !Array.isArray(p.findings)) continue;
      for (const f of p.findings) {
        out.push({ ...f, _service: svc.name || svc.role, _serviceRole: svc.role, _layer: layer, _path: p.path });
      }
    }
  }
  return out;
}

function reachabilityForRole(serviceResults, role) {
  const svc = (serviceResults || []).find((s) => s.role === role);
  if (!svc) return { state: "NOT_CONFIGURED", svc: null };
  if (svc.connection === "ok") return { state: "REACHABLE", svc };
  if (svc.connection === "failed") return { state: "UNREACHABLE", svc };
  return { state: "UNKNOWN", svc };
}

const ROLE_BY_LAYER = {
  "IPConnect": ["IPConnect"],
  "Pulse Gateway": ["Pulse Gateway"],
  "Integration Gateway": ["Integration Gateway"],
  "MQTT Broker": ["MQTT Broker"],
  "WebSocket MQTT Adapter": ["WebSocket MQTT Adapter"],
  "Display / IP-APP": [],
  "External Systems": ["Mobile Gateway", "HL7", "RTLS Gateway", "File Server"],
};

/* ---------------- Per-layer node builder ---------------- */

function buildNodeForLayer(layer, ctx) {
  const { target, siteConfig, serviceResults, findingsByLayer, matchedByLayer, allMatched } = ctx;

  const node = {
    layer,
    componentType: layer,
    componentName: layer,
    status: "NO_EVIDENCE",
    evidence: [],
    timestamp: null,
    latencyMs: null,
    nextHop: null,
    breakDetected: false,
    confidence: 0,
    reachable: null,
  };

  if (layer === "Input") {
    const cp = findCpInSiteConfig(target, siteConfig);
    if (cp) {
      node.componentType = cp.kind === "ipin8" ? "IP-IN8" : (cp.role || cp.kind || "Input");
      node.componentName = cp.name || cp.ip || target.label;
      node.evidence.push(`Site config: ${node.componentType} "${node.componentName}" matched in CCP/site config.`);
      node.status = "SIGNAL_RECEIVED";
      node.confidence = 70;
    } else if (["cpId", "room", "fqLocation"].includes(target.kind)) {
      node.evidence.push(`Site config: no ${target.kind === "cpId" ? "callpoint" : "device"} matching "${target.value}" in current CCP — CP id may be missing from configuration.`);
      node.status = "CONFIG_MISMATCH";
      node.confidence = 60;
      node.breakDetected = true;
    }
    const earliest = (allMatched || []).slice().sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")))[0];
    if (earliest) {
      node.evidence.push(`Log evidence: ${earliest._service} @ ${earliest.timestamp || "?"} — ${earliest.message}`);
      if (!node.timestamp) node.timestamp = earliest.timestamp || null;
      if (node.status === "NO_EVIDENCE") { node.status = "SIGNAL_RECEIVED"; node.confidence = 60; }
    }
    return node;
  }

  if (layer === "Controller") {
    const ctrl = (siteConfig?.controllers || []).find((c) => target.value && (
      String(c.controllerId || "").toLowerCase() === target.value.toLowerCase() ||
      String(c.id || "").toLowerCase() === target.value.toLowerCase()
    ));
    if (ctrl) {
      node.componentName = ctrl.name || `Controller ${ctrl.controllerId || ctrl.id}`;
      node.evidence.push(`Site config: controller "${node.componentName}" present.`);
    }
    const ctrlMentions = (allMatched || []).filter((f) => /controller|cct/i.test(f.raw || f.message || ""));
    if (ctrlMentions.length > 0) {
      node.evidence.push(`Log evidence: ${ctrlMentions.length} log line(s) reference controller for this target.`);
      node.status = "EVENT_PROPAGATED";
      node.confidence = 65;
      node.timestamp = ctrlMentions[0].timestamp || null;
    } else {
      node.evidence.push("No controller logs configured — cannot confirm propagation through controller layer.");
      node.confidence = 30;
    }
    return node;
  }

  const roles = ROLE_BY_LAYER[layer] || [];
  let reachState = "NOT_CONFIGURED";
  let reachSvc = null;
  for (const role of roles) {
    const r = reachabilityForRole(serviceResults, role);
    if (r.state !== "NOT_CONFIGURED") { reachState = r.state; reachSvc = r.svc; break; }
  }
  if (reachSvc) {
    node.componentName = reachSvc.name || layer;
    node.componentType = reachSvc.role || layer;
    node.reachable = reachState === "REACHABLE";
  }

  if (reachState === "REACHABLE") {
    node.evidence.push(`Reachability: ${node.componentName} reachable (${reachSvc.host || "host"}:${reachSvc.port || 22}, SSH/SFTP OK).`);
  } else if (reachState === "UNREACHABLE") {
    node.evidence.push(`Reachability: ${node.componentName} UNREACHABLE — ${reachSvc.message || "ping/port/SSH failed"}.`);
    node.status = "UNREACHABLE";
    node.breakDetected = true;
    node.confidence = 85;
  } else if (reachState === "NOT_CONFIGURED") {
    node.evidence.push(`Service "${roles.join(" / ") || layer}" is not configured in site setup.`);
    node.status = "NOT_CONFIGURED";
    node.confidence = 0;
  }

  const layerFindings = findingsByLayer[layer] || [];
  const matched = matchedByLayer[layer] || [];

  if (matched.length > 0) {
    const hasTimeout = matched.some((f) => f.type === "ACTIVATE_TIMEOUT" || f.type === "CANCEL_TIMEOUT" || f.type === "TIMEOUT");
    const hasInvalid = matched.some((f) => f.type === "INVALID_CALLPOINT" || f.type === "INVALID_SIGNAL");
    const hasDisconnect = matched.some((f) => f.type === "MQTT_DISCONNECT" || f.type === "WEBSOCKET_ERROR" || f.type === "CONNECTION_REFUSED");
    const first = matched[0];
    node.timestamp = node.timestamp || first.timestamp || null;

    if (hasTimeout) {
      node.status = "TIMEOUT"; node.breakDetected = true;
      node.confidence = Math.max(node.confidence, 92);
      node.evidence.push(`Log evidence: ${matched.length} matching timeout line(s) for ${target.label}.`);
    } else if (hasInvalid) {
      node.status = "CONFIG_MISMATCH"; node.breakDetected = true;
      node.confidence = Math.max(node.confidence, 88);
      node.evidence.push(`Log evidence: ${matched.length} invalid CP/signal line(s) for ${target.label}.`);
    } else if (hasDisconnect) {
      node.status = "UNREACHABLE"; node.breakDetected = true;
      node.confidence = Math.max(node.confidence, 88);
      node.evidence.push(`Log evidence: ${matched.length} disconnect/refused line(s).`);
    } else {
      node.status = (layer === "MQTT Broker" || layer === "WebSocket MQTT Adapter") ? "EVENT_ROUTED" : "EVENT_PROPAGATED";
      node.confidence = Math.max(node.confidence, 80);
      node.evidence.push(`Log evidence: ${matched.length} matching line(s) — event present at this layer.`);
    }
    for (const f of matched.slice(0, 3)) {
      node.evidence.push(`· ${f._service} ${f.timestamp || ""} ${f.type}: ${f.message}`);
    }
  } else if (layerFindings.length > 0 && reachState === "REACHABLE") {
    node.evidence.push(`Service logs present (${layerFindings.length} finding(s)) but none reference ${target.label} — cannot confirm propagation through this layer.`);
    if (node.status === "NO_EVIDENCE") node.confidence = Math.max(node.confidence, 35);
  } else if (reachState === "REACHABLE" && node.status !== "UNREACHABLE") {
    if (layer === "MQTT Broker" || layer === "WebSocket MQTT Adapter") {
      node.evidence.push("MQTT/Connexall live tap is not configured — cannot confirm message flow at this layer.");
    } else {
      node.evidence.push("No logs pulled for this service — cannot confirm propagation.");
    }
    if (node.status === "NO_EVIDENCE") node.confidence = 25;
  }

  if (layer === "Display / IP-APP") {
    const displays = siteConfig?.displays || [];
    if (displays.length > 0) {
      node.componentName = displays.length === 1 ? (displays[0].name || "Display / IP-APP") : `${displays.length} displays`;
      node.evidence.unshift(`Site config: ${displays.length} display(s) configured.`);
    } else {
      node.evidence.unshift("Site config: no displays configured — display delivery cannot be traced.");
    }
  }

  return node;
}

/* ---------------- Public entry ---------------- */

export function buildTraceResult({ target, siteConfig, serviceResults, deviceResults, deepEvidence = null }) {
  const t = normalizeTarget(target);
  if (!t.value && !t.fqLocation && !t.mqttTopic && !t.callType) {
    return { ok: false, reason: "invalid_request", message: "Trace target is required (CP id, room, fqLocation, call type, or MQTT topic)." };
  }

  const findings = flatFindings(serviceResults);
  const matchedAll = findings.filter((f) => findingMatchesTarget(f, t));

  const findingsByLayer = {};
  const matchedByLayer = {};
  for (const layer of LAYER_ORDER) { findingsByLayer[layer] = []; matchedByLayer[layer] = []; }
  for (const f of findings) {
    const layer = f._layer && LAYER_ORDER.includes(f._layer) ? f._layer : (ROLE_TO_LAYER[f._serviceRole] || null);
    if (!layer || !LAYER_ORDER.includes(layer)) continue;
    findingsByLayer[layer].push(f);
    if (findingMatchesTarget(f, t)) matchedByLayer[layer].push(f);
  }

  const ctx = { target: t, siteConfig, serviceResults, deviceResults, findingsByLayer, matchedByLayer, allMatched: matchedAll };

  const traceStartedAt = nowIso();
  const propagationPath = LAYER_ORDER.map((layer, i) => {
    const node = buildNodeForLayer(layer, ctx);
    node.nextHop = LAYER_ORDER[i + 1] || null;
    node.evidenceSource = (matchedByLayer[layer] || []).length > 0 ? "logs" : (node.evidence.length ? "logs" : "logs");
    return node;
  });

  /* ===== Deep Evidence overrides on top of log-derived nodes =====
   * Each override mutates the node status / evidence and tags evidenceSource.
   * Deep Evidence is read-only — we only annotate or strengthen conclusions. */
  const deepUsed = !!deepEvidence;
  const traceContradictionsUsed = [];
  if (deepUsed) {
    const tv = (t.value || "").toLowerCase();
    const inputNode = propagationPath.find((n) => n.layer === "Input");
    const ingaNode = propagationPath.find((n) => n.layer === "Integration Gateway");
    const mqttNode = propagationPath.find((n) => n.layer === "MQTT Broker");
    const externalNode = propagationPath.find((n) => n.layer === "External Systems");

    // (a) configTruth: CP missing from config → Input layer = CONFIG_MISMATCH
    if (inputNode && t.kind === "cpId" && tv && Array.isArray(deepEvidence.configTruth?.unknownCpIds) &&
        deepEvidence.configTruth.unknownCpIds.some((id) => String(id).toLowerCase() === tv || String(id).toLowerCase().includes(tv))) {
      inputNode.status = "CONFIG_MISMATCH";
      inputNode.breakDetected = true;
      inputNode.confidence = Math.max(inputNode.confidence, 90);
      inputNode.evidence.push(`[Deep Evidence] configTruth: CP ${t.value} not present in active site configuration.`);
      inputNode.evidenceSource = "deepEvidence";
      traceContradictionsUsed.push({ layer: "Input", kind: "config_unknown_cp_in_event", target: t.value });
    }

    // (b) INGA logged event but MQTT tap saw nothing for it
    const cMissing = (deepEvidence.contradictions || []).find((c) => c.kind === "log_event_missing_on_mqtt");
    if (cMissing && ingaNode && mqttNode) {
      ingaNode.status = "EVENT_PROPAGATED";
      ingaNode.evidence.push(`[Deep Evidence] INGA logged event observed; correlation with MQTT failed (${cMissing.sourceA.said}).`);
      ingaNode.evidenceSource = "logs+deepEvidence";
      mqttNode.status = "NO_EVIDENCE";
      mqttNode.breakDetected = true;
      mqttNode.confidence = Math.max(mqttNode.confidence, 88);
      mqttNode.evidence.push(`[Deep Evidence] MQTT tap did NOT observe a matching event during the tap window — break is between INGA and the broker.`);
      mqttNode.evidenceSource = "deepEvidence";
      traceContradictionsUsed.push({ layer: "MQTT Broker", kind: "log_event_missing_on_mqtt" });
    }

    // (c) MQTT saw event but no downstream ACK → External Systems break
    const cNoAck = (deepEvidence.contradictions || []).find((c) => c.kind === "mqtt_publish_no_ack");
    if (cNoAck && mqttNode && externalNode) {
      mqttNode.status = "EVENT_ROUTED";
      mqttNode.evidence.push(`[Deep Evidence] MQTT tap observed event published; downstream ACK missing.`);
      mqttNode.evidenceSource = "logs+deepEvidence";
      externalNode.status = "NO_EVIDENCE";
      externalNode.breakDetected = true;
      externalNode.confidence = Math.max(externalNode.confidence, 80);
      externalNode.evidence.push(`[Deep Evidence] No ACK on '${deepEvidence.mqttTruth?.ackTopic || "ack topic"}' — downstream consumer did not acknowledge.`);
      externalNode.evidenceSource = "deepEvidence";
      traceContradictionsUsed.push({ layer: "External Systems", kind: "mqtt_publish_no_ack" });
    }

    // (d) Host reachable but port closed for a service-bound layer
    const portContradictions = (deepEvidence.contradictions || []).filter((c) => c.kind === "host_reachable_port_closed");
    for (const c of portContradictions) {
      // Map service name (target) back to layer
      const target = (c.target || "").toLowerCase();
      for (const node of propagationPath) {
        if (node.componentName && target && node.componentName.toLowerCase().includes(target.split(":")[0])) {
          node.status = "HOST_REACHABLE_PORT_CLOSED";
          node.breakDetected = true;
          node.confidence = Math.max(node.confidence, 88);
          node.evidence.push(`[Deep Evidence] ${c.sourceA.said}; ${c.sourceB.said}.`);
          node.evidenceSource = "logs+deepEvidence";
          traceContradictionsUsed.push({ layer: node.layer, kind: c.kind, target: c.target });
          break;
        }
      }
    }
  }

  const timing = { hops: [] };
  for (let i = 1; i < propagationPath.length; i++) {
    const prev = propagationPath[i - 1];
    const cur = propagationPath[i];
    if (prev.timestamp && cur.timestamp) {
      const dt = Date.parse(cur.timestamp) - Date.parse(prev.timestamp);
      if (Number.isFinite(dt)) timing.hops.push({ from: prev.layer, to: cur.layer, deltaMs: dt });
    }
  }

  const breakIdx = propagationPath.findIndex((n) => n.breakDetected);
  const breakFoundAt = breakIdx >= 0 ? `${propagationPath[breakIdx].layer} (${propagationPath[breakIdx].componentName})` : null;

  let overallStatus, signalStatus;
  if (breakIdx >= 0) { overallStatus = "BROKEN"; signalStatus = "SIGNAL_LOST"; }
  else if (matchedAll.length === 0) { overallStatus = "NO_EVIDENCE"; signalStatus = "NO_EVIDENCE"; }
  else if (propagationPath.some((n) => n.status === "EVENT_PROPAGATED" || n.status === "EVENT_ROUTED")) { overallStatus = "PROPAGATED"; signalStatus = "EVENT_ALIVE"; }
  else { overallStatus = "PARTIAL"; signalStatus = "PARTIAL_EVIDENCE"; }

  const suspectedFailures = [];
  const ruledOutFailures = [];
  if (breakIdx >= 0) {
    const node = propagationPath[breakIdx];
    suspectedFailures.push({
      layer: node.layer,
      componentName: node.componentName,
      reason: node.status,
      explanation: deriveBreakExplanation(node, propagationPath, breakIdx, t),
      confidence: node.confidence,
    });
  }
  for (let i = 0; i < (breakIdx >= 0 ? breakIdx : propagationPath.length); i++) {
    const n = propagationPath[i];
    if (["SIGNAL_RECEIVED", "EVENT_PROPAGATED", "EVENT_ROUTED"].includes(n.status)) {
      ruledOutFailures.push(`${n.layer} (${n.componentName}) — propagation confirmed (${n.confidence}% conf).`);
    } else if (n.reachable) {
      ruledOutFailures.push(`${n.layer} (${n.componentName}) — reachable, no errors at this layer.`);
    }
  }

  const evidence = [];
  for (const n of propagationPath) for (const e of n.evidence) evidence.push(`[${n.layer}] ${e}`);

  const contributingNodes = propagationPath.filter((n) => n.confidence > 0);
  const overallConfidence = contributingNodes.length > 0
    ? Math.round(contributingNodes.reduce((s, n) => s + n.confidence, 0) / contributingNodes.length)
    : 0;

  const fixActions = breakIdx >= 0 ? fixActionsFor(propagationPath[breakIdx], t) : [];

  return {
    ok: true,
    traceId: `trace-${Date.now().toString(36)}`,
    traceTarget: t,
    overallStatus,
    signalStatus,
    traceStartedAt,
    traceEndedAt: nowIso(),
    breakFoundAt,
    confidence: overallConfidence,
    propagationPath,
    evidence,
    timing,
    suspectedFailures,
    ruledOutFailures,
    fixActions,
    notes: buildNotes({ matchedAll, serviceResults, target: t }),
    deepEvidenceUsed: deepUsed,
    deepEvidenceContradictionsUsed: traceContradictionsUsed,
    evidenceScore: deepUsed ? (deepEvidence.evidenceScore ?? 0) : 0,
  };
}

function deriveBreakExplanation(node, path, idx, target) {
  const upstream = path.slice(0, idx).filter((n) => ["EVENT_PROPAGATED", "EVENT_ROUTED", "SIGNAL_RECEIVED"].includes(n.status));
  if (node.status === "TIMEOUT") {
    if (upstream.length > 0) {
      const upstreamLabel = upstream.map((n) => n.layer).join(" → ");
      return `Signal propagated through ${upstreamLabel} but ${node.layer} timed out for ${target.label}. The break is at the ${node.layer} layer, not upstream.`;
    }
    return `${node.layer} timed out processing ${target.label}.`;
  }
  if (node.status === "CONFIG_MISMATCH") return `${node.layer} reports ${target.label} as invalid/unknown — likely a CCP/configuration mismatch rather than a network failure.`;
  if (node.status === "UNREACHABLE") return `${node.layer} (${node.componentName}) is not reachable from the diagnostic VM. Signal cannot proceed past this layer.`;
  return `Break detected at ${node.layer}: ${node.status}.`;
}

function fixActionsFor(node, target) {
  switch (node.status) {
    case "TIMEOUT":
      return [
        `Inspect ${node.componentName} application logs around the timeout for ${target.label}.`,
        "Check downstream dependency (broker, queue, or API the layer waits on).",
        "Verify the layer's worker/process is healthy (CPU, threads, queue depth).",
      ];
    case "CONFIG_MISMATCH":
      return [
        `Verify ${target.label} exists in the active CCP and matches the live site.`,
        "Re-import or republish the CCP if it is out of date.",
        "Confirm signal/CP id mapping on the controller and integration layer.",
      ];
    case "UNREACHABLE":
      return [
        `Restore network reachability to ${node.componentName} (ping, VLAN, switch port).`,
        "Confirm the service is running and listening on the expected port.",
      ];
    case "NOT_CONFIGURED":
      return [`Configure the ${node.layer} service in Site Setup so the trace can verify this layer.`];
    default:
      return [`Pull additional logs from ${node.layer} and re-run the trace.`];
  }
}

function buildNotes({ matchedAll, serviceResults, target }) {
  const notes = [];
  if ((serviceResults || []).length === 0) {
    notes.push("No service diagnosis run yet — trace is operating on configuration only. Run service diagnosis to enrich evidence.");
  }
  if (matchedAll.length === 0 && (serviceResults || []).length > 0) {
    notes.push(`No log lines reference ${target.label} in the latest pulled logs. Trace is reporting NO_EVIDENCE rather than fabricating a path.`);
  }
  notes.push("MQTT / Connexall live tap is not yet enabled. Message-bus propagation is inferred from logs only.");
  return notes;
}

export const TRACE_LAYERS = LAYER_ORDER;
