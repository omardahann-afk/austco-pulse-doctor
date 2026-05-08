/**
 * Deterministic cross-system correlation engine for Tacera/Pulse/Austco.
 *
 * Pure rules. No AI. Given the live state of all monitored devices,
 * active alerts, recent timeline events and (optionally) recent
 * correlated log patterns, it produces:
 *
 *   {
 *     generatedAt,
 *     systemIssues[],
 *     rootCauseCandidates[],   // ranked, deterministic
 *     cascadingFailures[],     // child symptoms inherited from parents
 *     affectedServices[],
 *     confidence,
 *     evidence[],
 *     recommendedPrimaryFix,
 *     doNotDo[],
 *     technicianFocusOrder[],
 *   }
 *
 * Direction matters: a controller cannot cause a broker refusal,
 * a broker outage cascades down to gateways/integrations.
 */

/* ----------------------------- Service map ----------------------------- */
/**
 * Logical service "layers". A device's profileKey (preferred) or kind
 * is mapped to one of these layer ids. Edges are PARENT -> CHILD,
 * meaning if PARENT fails, CHILD inherits degraded state.
 */
const LAYER = {
  MQTT: "mqtt-broker",
  LICENSE: "license-service",
  IPCONNECT: "ipconnect",
  PULSE_GW: "pulse-gateway",
  PULSE_MANAGE: "pulse-manage",
  INGA: "integration-gateway",
  HL7: "hl7",
  RTLS: "rtls-gateway",
  WS_MQTT: "ws-mqtt-adapter",
  MOBILE_GW: "mobile-gateway",
  WEBMIN: "ipc-webmin",
  FILE: "file-server",
  CONTROLLER: "controller-ping",
  SWITCH: "switch-ping",
};

const LAYER_LABEL = {
  [LAYER.MQTT]: "MQTT Broker",
  [LAYER.LICENSE]: "License Service",
  [LAYER.IPCONNECT]: "IPConnect",
  [LAYER.PULSE_GW]: "Pulse Gateway",
  [LAYER.PULSE_MANAGE]: "Pulse Manage",
  [LAYER.INGA]: "INGA Integration Gateway",
  [LAYER.HL7]: "HL7 Interface",
  [LAYER.RTLS]: "RTLS Gateway",
  [LAYER.WS_MQTT]: "WS-MQTT Adapter",
  [LAYER.MOBILE_GW]: "Mobile Gateway",
  [LAYER.WEBMIN]: "IPC Webmin",
  [LAYER.FILE]: "File Server",
  [LAYER.CONTROLLER]: "Controllers",
  [LAYER.SWITCH]: "Switch Fabric",
};

/** Parent -> children (causal direction). */
const DEPENDENCY_EDGES = [
  [LAYER.SWITCH,    LAYER.CONTROLLER],
  [LAYER.SWITCH,    LAYER.MQTT],
  [LAYER.CONTROLLER, LAYER.IPCONNECT],
  [LAYER.LICENSE,   LAYER.IPCONNECT],
  [LAYER.MQTT,      LAYER.IPCONNECT],
  [LAYER.MQTT,      LAYER.PULSE_GW],
  [LAYER.MQTT,      LAYER.INGA],
  [LAYER.MQTT,      LAYER.WS_MQTT],
  [LAYER.MQTT,      LAYER.RTLS],
  [LAYER.PULSE_GW,  LAYER.PULSE_MANAGE],
  [LAYER.PULSE_GW,  LAYER.MOBILE_GW],
  [LAYER.INGA,      LAYER.HL7],
  [LAYER.IPCONNECT, LAYER.PULSE_GW],
];

function childrenOf(layer) {
  return DEPENDENCY_EDGES.filter(([p]) => p === layer).map(([, c]) => c);
}

/** Risk weight per layer — used to rank root cause candidates. */
const LAYER_BLAST_RADIUS = {
  [LAYER.MQTT]: 10,
  [LAYER.LICENSE]: 8,
  [LAYER.SWITCH]: 9,
  [LAYER.IPCONNECT]: 7,
  [LAYER.PULSE_GW]: 6,
  [LAYER.INGA]: 5,
  [LAYER.HL7]: 3,
  [LAYER.RTLS]: 3,
  [LAYER.PULSE_MANAGE]: 3,
  [LAYER.MOBILE_GW]: 3,
  [LAYER.WS_MQTT]: 3,
  [LAYER.WEBMIN]: 2,
  [LAYER.FILE]: 2,
  [LAYER.CONTROLLER]: 4,
};

function deviceLayer(device) {
  const meta = device?.meta || {};
  const pk = String(meta.profileKey || "").trim();
  if (pk && LAYER_LABEL[pk]) return pk;
  // Fallback by kind
  switch (String(device?.kind || "")) {
    case "broker": return LAYER.MQTT;
    case "controller": return LAYER.CONTROLLER;
    case "switch": return LAYER.SWITCH;
    case "vm": return LAYER.IPCONNECT;
    case "gateway": return LAYER.PULSE_GW;
    default: return null;
  }
}

/* --------------------------- Signal extraction ------------------------- */
function isDownState(state) {
  return state === "down" || state === "degraded" || state === "stale";
}

function aggregateLayerHealth(devices) {
  // Map layer -> { total, downDevices[], healthyDevices[], downReasons[] }
  const map = new Map();
  for (const d of devices) {
    const layer = deviceLayer(d);
    if (!layer) continue;
    const bucket = map.get(layer) || { total: 0, down: [], healthy: [] };
    bucket.total += 1;
    if (isDownState(d.state)) bucket.down.push(d);
    else if (d.state === "up") bucket.healthy.push(d);
    map.set(layer, bucket);
  }
  return map;
}

function patternHitsByLayer(alerts) {
  // Translate active alerts into layer-level hit counts using patternIds.
  const layerHits = new Map();
  function bump(layer, alert, weight = 1) {
    const b = layerHits.get(layer) || { count: 0, alerts: [], weight: 0 };
    b.count += 1;
    b.weight += weight;
    b.alerts.push(alert);
    layerHits.set(layer, b);
  }
  for (const a of alerts) {
    if (a.status !== "active") continue;
    const w = a.severity === "critical" ? 2 : 1;
    const ids = (a.patternIds || []).map(String);
    const txt = `${a.title || ""} ${a.description || ""}`.toLowerCase();
    if (ids.some((i) => i.startsWith("mqtt.")) || /mqtt|mosquitto|broker|1883/.test(txt)) bump(LAYER.MQTT, a, w);
    if (ids.some((i) => i.startsWith("pulse.")) || /pulse[- ]?gateway/.test(txt)) bump(LAYER.PULSE_GW, a, w);
    if (ids.some((i) => i.startsWith("inga.")) || /inga|integration/.test(txt)) bump(LAYER.INGA, a, w);
    if (ids.some((i) => i.startsWith("ipc.")) || /ipconnect|controller offline/.test(txt)) bump(LAYER.IPCONNECT, a, w);
    if (ids.some((i) => i.startsWith("hl7.")) || /hl7|mllp/.test(txt)) bump(LAYER.HL7, a, w);
    if (ids.some((i) => i.startsWith("webmin.")) || /webmin|miniserv/.test(txt)) bump(LAYER.WEBMIN, a, w);
    if (ids.some((i) => i.startsWith("controller.")) || /heartbeat|ping/.test(txt)) bump(LAYER.CONTROLLER, a, w);
    if (/license/.test(txt)) bump(LAYER.LICENSE, a, w);
  }
  return layerHits;
}

/* ------------------------- Root cause candidates ----------------------- */
function scoreLayer(layer, layerHealth, layerHits) {
  const health = layerHealth.get(layer) || { total: 0, down: [], healthy: [] };
  const hits = layerHits.get(layer) || { count: 0, alerts: [], weight: 0 };
  if (health.total === 0 && hits.count === 0) return null;

  const downRatio = health.total ? health.down.length / health.total : 0;
  const baseFromHealth = downRatio * 6;        // up to 6
  const baseFromAlerts = Math.min(6, hits.weight); // up to 6
  const blast = LAYER_BLAST_RADIUS[layer] || 1;

  const score = (baseFromHealth + baseFromAlerts) * (blast / 10);
  // Confidence: mix of evidence breadth + alert weight
  const confidence = Math.max(
    0.2,
    Math.min(0.99, 0.35 + downRatio * 0.4 + Math.min(0.3, hits.weight * 0.08)),
  );

  return {
    layer,
    label: LAYER_LABEL[layer],
    score: Number(score.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    downDevices: health.down.map((d) => ({ id: d.id, name: d.name, state: d.state, lastError: d.last_error || null })),
    activeAlerts: hits.alerts.map((a) => ({
      alertId: a.alertId, title: a.title, severity: a.severity, deviceId: a.deviceId,
    })),
    blastRadius: blast,
  };
}

/** A child layer can be a root cause only if no upstream parent is failing. */
function hasFailingParent(layer, failingLayers) {
  for (const [p, c] of DEPENDENCY_EDGES) {
    if (c === layer && failingLayers.has(p)) return true;
  }
  return false;
}

function descendants(layer) {
  const out = new Set();
  const stack = [layer];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of childrenOf(cur)) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return [...out];
}

/* ------------------------ Remediation playbooks ------------------------ */
const PLAYBOOK = {
  [LAYER.MQTT]: {
    primaryFix: "Restore the MQTT broker (mosquitto). Verify it is listening on :1883 and that recent xcare/# traffic resumes before touching anything downstream.",
    doNotDo: [
      "Do not restart Pulse Gateway first.",
      "Do not restart INGA first.",
      "Do not reboot controllers — they are not the cause.",
    ],
    order: [
      "Verify MQTT broker process and port 1883.",
      "Verify Pulse Gateway reconnects cleanly.",
      "Verify INGA publish queue drains.",
      "Validate controller event flow end-to-end.",
    ],
  },
  [LAYER.LICENSE]: {
    primaryFix: "Restore the License Service. IPConnect cannot validate controllers without it.",
    doNotDo: [
      "Do not restart MQTT — it is healthy.",
      "Do not restart Pulse Gateway.",
      "Do not reimage controllers.",
    ],
    order: [
      "Verify License Service reachability and validity.",
      "Verify IPConnect resumes controller processing.",
      "Confirm event flow to Pulse Gateway / INGA.",
    ],
  },
  [LAYER.IPCONNECT]: {
    primaryFix: "Recover IPConnect. Check VM, HTTPS endpoint, then license / MQTT dependencies.",
    doNotDo: [
      "Do not restart controllers first.",
      "Do not restart Pulse Gateway before IPConnect is back.",
    ],
    order: [
      "Verify IPConnect VM and HTTPS health.",
      "Verify upstream dependencies (License, MQTT) are healthy.",
      "Validate controller event flow.",
    ],
  },
  [LAYER.PULSE_GW]: {
    primaryFix: "Inspect and recover the pulse-gateway container. Check docker ps, logs, and HTTPS :443.",
    doNotDo: [
      "Do not restart MQTT — it is healthy.",
      "Do not reboot the VM as a first step.",
      "Do not restart INGA before Pulse Gateway is healthy.",
    ],
    order: [
      "Inspect pulse-gateway container state and recent logs.",
      "Restart container if safe; verify HTTPS :443 returns.",
      "Verify Pulse Manage and Mobile Gateway recover.",
    ],
  },
  [LAYER.INGA]: {
    primaryFix: "Recover INGA publish path. First confirm broker is healthy, then drain the publish queue.",
    doNotDo: [
      "Do not restart INGA before confirming MQTT is healthy.",
      "Do not restart HL7 receiver before INGA is publishing.",
    ],
    order: [
      "Confirm MQTT broker health.",
      "Inspect INGA queue depth and publish errors.",
      "Restart INGA only if broker is healthy and queue is stuck.",
    ],
  },
  [LAYER.HL7]: {
    primaryFix: "Inspect downstream HL7 receiver. INGA is healthy.",
    doNotDo: [
      "Do not restart MQTT.",
      "Do not restart INGA before checking the downstream receiver.",
    ],
    order: [
      "Verify downstream HL7 receiver port and ACKs.",
      "Inspect MLLP socket errors.",
      "Coordinate restart with the integration owner.",
    ],
  },
  [LAYER.CONTROLLER]: {
    primaryFix: "Inspect controller cabling, PoE port, VLAN. Server-side services are healthy.",
    doNotDo: [
      "Do not restart server-side services (MQTT, Pulse, INGA).",
      "Do not reload site config — controller is unreachable at L2/L3.",
    ],
    order: [
      "Check switch port and PoE for the affected controller.",
      "Verify VLAN / cabling.",
      "Replace controller only if PoE/cabling is confirmed good.",
    ],
  },
  [LAYER.SWITCH]: {
    primaryFix: "Recover the network switch fabric. Multiple downstream layers are failing for the same reason.",
    doNotDo: [
      "Do not restart application services until L2 is recovered.",
    ],
    order: [
      "Inspect the switch (uplink, port errors, PoE budget).",
      "Once L2/L3 is restored, verify controllers and broker.",
      "Then verify downstream services recover.",
    ],
  },
  [LAYER.WEBMIN]: {
    primaryFix: "Restart Webmin / miniserv on the affected host (medium risk).",
    doNotDo: ["Do not restart unrelated services."],
    order: ["Restart webmin service.", "Verify TCP :10000 / HTTPS responds."],
  },
};

function buildPlaybook(layer) {
  return PLAYBOOK[layer] || {
    primaryFix: `Investigate ${LAYER_LABEL[layer] || layer} directly.`,
    doNotDo: ["Do not restart unrelated upstream services without evidence."],
    order: [`Inspect ${LAYER_LABEL[layer] || layer} runtime state and logs.`],
  };
}

/* ------------------------------ Main run ------------------------------- */
/**
 * @param {object} input
 * @param {Array} input.devices       monitored devices (with .meta.profileKey)
 * @param {Array} input.deviceStates  output of listDeviceStates()
 * @param {Array} input.activeAlerts  output of listAlerts({status:"active"})
 * @param {Array} [input.timeline]    recent timeline events
 */
export function runSystemCorrelation({ devices = [], deviceStates = [], activeAlerts = [], timeline = [] } = {}) {
  // Merge state into devices so we can read .state/.last_error
  const stateById = new Map(deviceStates.map((s) => [s.id, s]));
  const merged = devices.map((d) => {
    const s = stateById.get(d.id) || {};
    return { ...d, state: s.state || "unknown", last_error: s.last_error || null };
  });

  const layerHealth = aggregateLayerHealth(merged);
  const layerHits = patternHitsByLayer(activeAlerts);

  // All layers seen anywhere
  const layers = new Set([...layerHealth.keys(), ...layerHits.keys()]);

  // Score each layer
  const scored = [];
  for (const layer of layers) {
    const s = scoreLayer(layer, layerHealth, layerHits);
    if (s && s.score > 0) scored.push(s);
  }

  // Set of layers with any failure signal
  const failingLayers = new Set(scored.map((s) => s.layer));

  // Root cause = failing layer with NO failing parent. Sort by score desc.
  const rootCauseCandidates = scored
    .filter((s) => !hasFailingParent(s.layer, failingLayers))
    .sort((a, b) => b.score - a.score)
    .map((s) => {
      const cascade = descendants(s.layer).filter((c) => failingLayers.has(c));
      const playbook = buildPlaybook(s.layer);
      return {
        layer: s.layer,
        label: s.label,
        confidence: s.confidence,
        score: s.score,
        blastRadius: s.blastRadius,
        downDevices: s.downDevices,
        activeAlerts: s.activeAlerts,
        cascade: cascade.map((c) => ({ layer: c, label: LAYER_LABEL[c] })),
        primaryFix: playbook.primaryFix,
        doNotDo: playbook.doNotDo,
        technicianFocusOrder: playbook.order,
      };
    });

  // Cascading failures: any failing layer whose failure is "explained by" a parent
  const cascadingFailures = scored
    .filter((s) => hasFailingParent(s.layer, failingLayers))
    .map((s) => {
      const explainedBy = DEPENDENCY_EDGES
        .filter(([p, c]) => c === s.layer && failingLayers.has(p))
        .map(([p]) => ({ layer: p, label: LAYER_LABEL[p] }));
      return {
        layer: s.layer,
        label: s.label,
        explainedBy,
        downDevices: s.downDevices,
        activeAlerts: s.activeAlerts,
      };
    });

  const affectedServices = [...failingLayers].map((l) => ({ layer: l, label: LAYER_LABEL[l] || l }));

  // Top-level system issues = root cause candidates + standalone failing layers
  const systemIssues = rootCauseCandidates.length
    ? rootCauseCandidates.map((rc) => ({
        title: `${rc.label} appears to be the root cause`,
        severity: rc.confidence >= 0.7 ? "critical" : "warning",
        layer: rc.layer,
        confidence: rc.confidence,
        cascade: rc.cascade,
      }))
    : [];

  const evidence = [
    ...activeAlerts.slice(0, 25).map((a) => ({
      kind: "alert", id: a.alertId, severity: a.severity, title: a.title, deviceId: a.deviceId, at: a.updatedAt,
    })),
    ...timeline.slice(0, 25).map((e) => ({
      kind: "timeline", id: e.eventId, severity: e.severity, title: e.title, deviceId: e.deviceId, at: e.createdAt,
    })),
  ];

  const top = rootCauseCandidates[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    systemIssues,
    rootCauseCandidates,
    cascadingFailures,
    affectedServices,
    confidence: top ? top.confidence : 0,
    evidence,
    recommendedPrimaryFix: top ? top.primaryFix : null,
    doNotDo: top ? top.doNotDo : [],
    technicianFocusOrder: top ? top.technicianFocusOrder : [],
  };
}

export const SYSTEM_LAYERS = LAYER;
export const SYSTEM_LAYER_LABELS = LAYER_LABEL;
export const SYSTEM_DEPENDENCY_EDGES = DEPENDENCY_EDGES;