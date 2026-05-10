/**
 * Signal Path Engine (M2)
 * -----------------------
 * Pure deterministic. Given the normalized events for a capture session,
 * produce a layer-by-layer signal trace and identify WHERE propagation
 * stopped:
 *
 *   Callpoint → Controller (ip-cct) → IPConnect → Routing/MQTT
 *      → Pulse Gateway → Display / Mobile / Integration (HL7/INGA)
 */

const LAYERS = [
  { id: "callpoint",    label: "Callpoint",        match: (e) => Boolean(e.callpointId) },
  { id: "ip-cct",       label: "Controller (IP-CCT)", match: (e) => e.applianceType === "ip-cct" },
  { id: "ipconnect",    label: "IPConnect (routing/config)", match: (e) => e.applianceType === "ipconnect" },
  { id: "mqtt-broker",  label: "MQTT Broker",      match: (e) => e.applianceType === "mqtt-broker" },
  { id: "pulse-gateway",label: "Pulse Gateway",    match: (e) => e.applianceType === "pulse-gateway" },
  { id: "display",      label: "Display (IP-APP1 / AN-PD2 / ODL)", match: (e) => ["ip-app1", "an-pd2", "odl"].includes(e.applianceType) },
  { id: "pulse-mobile", label: "Pulse Mobile",     match: (e) => e.applianceType === "pulse-mobile" },
  { id: "inga",         label: "Integration (INGA / HL7)", match: (e) => e.applianceType === "inga" || e.applianceType === "hl7" },
];

function tsMs(e) {
  if (!e?.timestamp) return null;
  const t = Date.parse(e.timestamp);
  return Number.isNaN(t) ? null : t;
}

export function buildSignalPath({ session }) {
  const events = Array.isArray(session?.normalizedEvents) ? session.normalizedEvents : [];
  const reproStart = session?.reproductionStartedAt ? Date.parse(session.reproductionStartedAt) : null;
  const reproEnd = session?.reproductionEndedAt ? Date.parse(session.reproductionEndedAt) : null;
  const inWindow = (e) => {
    if (reproStart == null || reproEnd == null) return true;
    const t = tsMs(e); if (t == null) return false;
    return t >= reproStart && t <= reproEnd;
  };

  const path = LAYERS.map((layer) => {
    const layerEvents = events.filter((e) => layer.match(e) && inWindow(e));
    const failures = layerEvents.filter((e) => e.severity === "critical" || e.severity === "warning");
    const acks = layerEvents.filter((e) => e.severity === "info");
    const status = failures.length ? "failed" : (layerEvents.length ? "ok" : "no_evidence");
    return {
      layerId: layer.id,
      label: layer.label,
      status,
      eventCount: layerEvents.length,
      failureCount: failures.length,
      ackCount: acks.length,
      firstFailureAt: failures.length
        ? failures.slice().sort((a, b) => (tsMs(a) || 0) - (tsMs(b) || 0))[0].timestamp
        : null,
    };
  });

  // First missing ack = first layer with no_evidence after a layer that had OK/failure
  let firstMissingAck = null;
  let sawSignal = false;
  for (const layer of path) {
    if (layer.status !== "no_evidence") sawSignal = true;
    else if (sawSignal && !firstMissingAck) firstMissingAck = layer.layerId;
  }

  // Broken hop = first layer with status=failed
  const brokenHop = path.find((l) => l.status === "failed")?.layerId || null;

  // Propagation stop = earliest of broken hop or first missing ack
  const propagationStop = brokenHop || firstMissingAck;

  // Downstream symptoms = failed layers that come AFTER the broken hop in LAYERS order
  let downstreamSymptoms = [];
  if (brokenHop) {
    const idx = path.findIndex((l) => l.layerId === brokenHop);
    downstreamSymptoms = path.slice(idx + 1).filter((l) => l.status === "failed").map((l) => l.layerId);
  }

  return {
    signalPath: path,
    firstMissingAck,
    brokenHop,
    propagationStop,
    downstreamSymptoms,
  };
}
