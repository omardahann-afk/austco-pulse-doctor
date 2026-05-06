/**
 * DEV-ONLY mock Deep Evidence scenarios.
 *
 * Each scenario returns a fully shaped DeepEvidence object that mirrors what
 * `collectDeepEvidence` would produce in real life. Engines downstream
 * (rootCause, trace, autopilot) consume these directly. The cache marks them
 * with `mock: true` so Autopilot refuses to execute remediation against mock
 * evidence.
 *
 * NEVER ship a scenario without a `mockTag` — the UI uses it to label
 * "DEV MOCK — not real site data".
 */

const NOW = () => new Date().toISOString();
const STALE = () => new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min old

function baseEvidence({ mockTag, mockDescription, collectedAt }) {
  return {
    collectedAt: collectedAt || NOW(),
    finishedAt: collectedAt || NOW(),
    mockTag,
    mockDescription,
    targets: [],
    networkTruth: { collectedAt: NOW(), sourceVm: { interfaces: [] }, targets: [] },
    processTruth: { collectedAt: NOW(), services: [] },
    portTruth: { collectedAt: NOW(), services: [] },
    mqttTruth: { available: false, reason: "mock", message: "Mock scenario — no real broker." },
    configTruth: { collectedAt: NOW(), counts: {}, issues: [], unknownCpIds: [], observedCpIds: [] },
    stateTruth: { collectedAt: NOW(), available: false, note: "Mock scenario." },
    contradictions: [],
    rootCauseSignals: [],
    traceSignals: [],
    evidenceScore: 75,
  };
}

function hostReachablePortClosed() {
  const e = baseEvidence({
    mockTag: "host_reachable_port_closed",
    mockDescription: "Webmin host responds to ping but TCP/10000 is closed.",
  });
  e.targets = [{ id: "svc-pulse", name: "Pulse Manage", role: "Pulse Manage", host: "10.0.0.21", hostname: "pulse", kind: "service" }];
  e.networkTruth.targets = [{
    name: "Pulse Manage", host: "10.0.0.21",
    ping: { reachable: true, avgLatencyMs: 1.2 },
    tcpChecks: [{ port: 22, open: true }, { port: 10000, open: false, error: "ECONNREFUSED" }],
    arp: { entry: { ip: "10.0.0.21", mac: "aa:bb:cc:dd:ee:01" } },
    issues: [],
  }];
  e.contradictions = [{
    kind: "host_reachable_port_closed",
    sourceA: { layer: "network", said: "Ping 10.0.0.21 succeeded (1.2ms avg)" },
    sourceB: { layer: "network", said: "TCP 10.0.0.21:10000 closed (ECONNREFUSED)" },
    why: "VM is alive but Webmin is not accepting connections on the expected port.",
    likelyLayer: "service", confidence: 0.9, target: "Pulse Manage",
    nextCheck: "On Pulse Manage: systemctl status webmin",
  }];
  e.rootCauseSignals = [{ layer: "service", signal: "host_reachable_port_closed", target: "Pulse Manage", confidence: 0.9, message: "Ping ok vs port 10000 closed" }];
  e.traceSignals = [{ break: "service", kind: "host_reachable_port_closed", target: "Pulse Manage", evidence: ["ping ok", "tcp closed"] }];
  return e;
}

function serviceActiveListenerMissing() {
  const e = baseEvidence({
    mockTag: "service_running_no_port",
    mockDescription: "systemd reports service active but no process listens on the expected port.",
  });
  e.targets = [{ id: "svc-mqtt", name: "MQTT Broker", role: "MQTT Broker", host: "10.0.0.30", hostname: "mqtt", kind: "service" }];
  e.processTruth.services = [{ name: "MQTT Broker", host: "10.0.0.30", unit: "mosquitto.service", isActive: "active", sshConnected: true }];
  e.portTruth.services = [{ name: "MQTT Broker", host: "10.0.0.30", sshConnected: true, portChecks: [{ port: 1883, listening: false, expected: true, expectedProcOk: false, owners: [] }] }];
  e.contradictions = [{
    kind: "service_running_no_port",
    sourceA: { layer: "process", said: "mosquitto.service is active on 10.0.0.30" },
    sourceB: { layer: "ports", said: "Port 1883 not bound on 10.0.0.30" },
    why: "Service runs but isn't listening — config bind error or startup failure mid-init.",
    likelyLayer: "application", confidence: 0.8, target: "MQTT Broker",
    nextCheck: "journalctl -u mosquitto -n 200",
  }];
  e.rootCauseSignals = [{ layer: "application", signal: "service_running_no_port", target: "MQTT Broker", confidence: 0.8, message: "active but no listener on 1883" }];
  e.traceSignals = [{ break: "application", kind: "service_running_no_port", target: "MQTT Broker", evidence: ["systemd active", "port 1883 silent"] }];
  return e;
}

function ingaEventMissingOnMqtt() {
  const e = baseEvidence({
    mockTag: "log_event_missing_on_mqtt",
    mockDescription: "INGA logged event evt-9001 but MQTT tap never observed it.",
  });
  e.mqttTruth = { available: true, eventCount: 12, silence: false, observedCpIds: ["CP-1", "CP-2"], topicCounts: { "events/raw": 12 }, missingAcks: [], ackTopic: null };
  e.contradictions = [{
    kind: "log_event_missing_on_mqtt",
    sourceA: { layer: "logs", said: "INGA logged event evt-9001" },
    sourceB: { layer: "mqtt", said: "Event evt-9001 not observed on MQTT during tap window" },
    why: "Break between INGA and the MQTT broker — wrong topic, wrong broker, or auth failure.",
    likelyLayer: "integration", confidence: 0.85,
    nextCheck: "Verify MQTT broker host/topic in INGA config; check broker auth and ACLs",
  }];
  e.rootCauseSignals = [{ layer: "integration", signal: "log_event_missing_on_mqtt", target: null, confidence: 0.85, message: "INGA log vs MQTT tap" }];
  e.traceSignals = [{ break: "integration", kind: "log_event_missing_on_mqtt", target: null, evidence: ["INGA logged evt-9001", "MQTT tap silent"] }];
  return e;
}

function mqttEventMissingAck() {
  const e = baseEvidence({
    mockTag: "mqtt_publish_no_ack",
    mockDescription: "Events published to broker but no downstream ACK observed.",
  });
  e.mqttTruth = { available: true, eventCount: 30, silence: false, observedCpIds: ["CP-1"], topicCounts: { "events/raw": 30 }, missingAcks: ["evt-101", "evt-102", "evt-103"], ackTopic: "events/ack" };
  e.contradictions = [{
    kind: "mqtt_publish_no_ack",
    sourceA: { layer: "mqtt", said: "3 events published without observed ACK" },
    sourceB: { layer: "downstream", said: "Configured ack topic 'events/ack' produced no matching messages" },
    why: "Event reaches the broker but downstream integration never confirms receipt.",
    likelyLayer: "integration", confidence: 0.75,
    nextCheck: "Check downstream consumer (Connexall/Pulse Gateway) connectivity to broker",
  }];
  e.rootCauseSignals = [{ layer: "integration", signal: "mqtt_publish_no_ack", target: null, confidence: 0.75, message: "MQTT publish without downstream ACK" }];
  e.traceSignals = [{ break: "integration", kind: "mqtt_publish_no_ack", target: null, evidence: ["broker received", "no ACK on events/ack"] }];
  return e;
}

function cpObservedNotInConfig() {
  const e = baseEvidence({
    mockTag: "cp_observed_not_configured",
    mockDescription: "CP IDs seen on the wire that are not in site config.",
  });
  const unknown = ["CP-7", "CP-8"];
  e.configTruth = { collectedAt: NOW(), counts: { controllers: 4 }, issues: [{ kind: "cp_unknown", detail: "CPs not in site config", target: unknown.join(",") }], unknownCpIds: unknown, observedCpIds: ["CP-1", "CP-2", ...unknown] };
  e.contradictions = [{
    kind: "cp_observed_not_configured",
    sourceA: { layer: "events", said: `Observed ${unknown.length} CP IDs in live evidence` },
    sourceB: { layer: "config", said: `These CPs are not present in site config: ${unknown.join(", ")}` },
    why: "Physical/logical devices exist on the wire but are not in the configuration model.",
    likelyLayer: "configuration", confidence: 0.8,
    nextCheck: "Sync site config with deployed CCP; add the missing CPs",
  }];
  e.rootCauseSignals = [{ layer: "configuration", signal: "cp_observed_not_configured", target: null, confidence: 0.8, message: `Unknown CPs ${unknown.join(", ")}` }];
  return e;
}

function staleEvidence() {
  const e = baseEvidence({
    mockTag: "stale",
    mockDescription: "Evidence collected 30 minutes ago — should be flagged stale by UI/Autopilot.",
    collectedAt: STALE(),
  });
  return e;
}

export const SCENARIOS = {
  host_reachable_port_closed: { label: "Host reachable but port closed", build: hostReachablePortClosed },
  service_running_no_port: { label: "Service active but listener missing", build: serviceActiveListenerMissing },
  log_event_missing_on_mqtt: { label: "INGA event missing on MQTT", build: ingaEventMissingOnMqtt },
  mqtt_publish_no_ack: { label: "MQTT event missing ACK", build: mqttEventMissingAck },
  cp_observed_not_configured: { label: "CP observed but not in config", build: cpObservedNotInConfig },
  stale: { label: "Stale evidence (30 min old)", build: staleEvidence },
};

export function listScenarios() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }));
}

export function buildScenario(id) {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s.build();
}