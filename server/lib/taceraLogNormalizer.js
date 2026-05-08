/**
 * Tacera Log Normalizer
 * ---------------------
 * Pure deterministic. No AI. Converts raw log lines from any Tacera/Austco
 * appliance into normalized events the correlation/alert engines can reason
 * about.
 *
 * normalize({ deviceProfile, lines, sourcePath }) -> { events: [...] }
 *
 * Each event:
 *   {
 *     timestamp,           // ISO if extractable, else null
 *     sourceService,       // canonical service: mqtt|inga|pulse-gateway|...
 *     sourceDeviceId,      // passed-through from caller
 *     severity,            // info|warning|critical
 *     eventType,           // short machine label, e.g. MQTT_CONNECTION_REFUSED
 *     rawLine,             // original line (truncated)
 *     normalizedMeaning,   // short human English
 *     relatedServices,     // services possibly impacted by/related to this event
 *     confidenceImpact,    // { rootCauseHint: string, delta: number }
 *     correlationTags,     // tags for the correlation engine
 *     suggestedTechCheck,  // safe deterministic next-check (no auto-action)
 *     line,                // 1-based line index in the supplied window
 *   }
 */

const RX_TS_ISO = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
const RX_TS_SYSLOG = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/;

function extractTimestamp(line) {
  const iso = line.match(RX_TS_ISO);
  if (iso) return iso[1];
  const sys = line.match(RX_TS_SYSLOG);
  if (sys) return sys[1];
  return null;
}

/**
 * Map a device profile/kind to a canonical service tag used for routing rules.
 * Devices register with `kind` (e.g. mqtt, inga, pulse-gateway, ipc-webmin,
 * controller-ping, ...). We keep a tolerant mapping.
 */
function canonicalServiceFor(profile) {
  const k = String(profile?.kind || profile?.profileKey || profile?.key || "").toLowerCase();
  if (!k) return "unknown";
  if (/mqtt|broker|mosquitto/.test(k)) return "mqtt";
  if (/inga|integration[-_ ]?gateway/.test(k)) return "inga";
  if (/pulse[-_ ]?gateway/.test(k)) return "pulse-gateway";
  if (/pulse[-_ ]?manage/.test(k)) return "pulse-manage";
  if (/hl7|mllp/.test(k)) return "hl7";
  if (/license/.test(k)) return "license";
  if (/rtls/.test(k)) return "rtls";
  if (/webmin|miniserv|ipc/.test(k)) return "ipconnect";
  if (/controller/.test(k)) return "controller";
  if (/docker|container/.test(k)) return "docker";
  if (/switch|poe/.test(k)) return "network";
  return k;
}

/**
 * Rule table.
 * Each rule:
 *   - service: which canonical service this rule applies to (or "*" for any)
 *   - re: regex that triggers
 *   - eventType, severity, normalizedMeaning, relatedServices,
 *     correlationTags, suggestedTechCheck, rootCauseHint, delta
 */
const RULES = [
  // -------------------- MQTT --------------------
  { service: "*", re: /ECONNREFUSED.*\b1883\b|connection refused.*broker|broker (?:unavailable|unreachable|refused)/i,
    eventType: "MQTT_CONNECTION_REFUSED", severity: "critical",
    normalizedMeaning: "MQTT broker refused the TCP connection",
    relatedServices: ["mqtt", "inga", "pulse-gateway"],
    correlationTags: ["mqtt", "broker_down"],
    suggestedTechCheck: "Verify mosquitto is running on the broker host and TCP 1883 is open from this host.",
    rootCauseHint: "mqtt-broker-down", delta: 25 },
  { service: "*", re: /\bECONNREFUSED\b/i,
    eventType: "TCP_CONNECTION_REFUSED", severity: "warning",
    normalizedMeaning: "Downstream service refused the TCP connection",
    relatedServices: ["network"],
    correlationTags: ["tcp_refused"],
    suggestedTechCheck: "Confirm the target service is running and listening on the expected port.",
    rootCauseHint: "downstream-service-down", delta: 10 },
  { service: "*", re: /(client disconnected|connection lost to broker|disconnected from broker)/i,
    eventType: "MQTT_CLIENT_DISCONNECTED", severity: "warning",
    normalizedMeaning: "MQTT client lost its connection to the broker",
    relatedServices: ["mqtt"],
    correlationTags: ["mqtt", "client_disconnect"],
    suggestedTechCheck: "Check broker uptime and the network path between client and broker.",
    rootCauseHint: "mqtt-flap", delta: 8 },
  { service: "*", re: /(mqtt.*auth(entication)? (failed|denied)|not authori[sz]ed.*broker)/i,
    eventType: "MQTT_AUTH_FAILED", severity: "critical",
    normalizedMeaning: "MQTT broker rejected client credentials",
    relatedServices: ["mqtt"],
    correlationTags: ["mqtt", "auth"],
    suggestedTechCheck: "Verify MQTT username/password and broker ACL for this client.",
    rootCauseHint: "mqtt-auth", delta: 15 },
  { service: "mqtt", re: /(no traffic|stale|no messages received) for \d+/i,
    eventType: "MQTT_STALE_TRAFFIC", severity: "warning",
    normalizedMeaning: "MQTT broker is up but no recent traffic on monitored topics",
    relatedServices: ["mqtt", "inga", "pulse-gateway"],
    correlationTags: ["mqtt", "stale"],
    suggestedTechCheck: "Check publishers (INGA / Pulse Gateway) are running.",
    rootCauseHint: "publisher-silent", delta: 6 },

  // -------------------- INGA --------------------
  { service: "inga", re: /(failed to publish|publish .* (timed ?out|no ack))/i,
    eventType: "INGA_PUBLISH_NO_ACK", severity: "warning",
    normalizedMeaning: "INGA published an event but never received an MQTT ACK",
    relatedServices: ["inga", "mqtt"],
    correlationTags: ["inga", "mqtt", "no_ack"],
    suggestedTechCheck: "Check broker first; only restart INGA after broker is confirmed healthy.",
    rootCauseHint: "mqtt-broker-down", delta: 10 },
  { service: "inga", re: /(event queue full|queue overflow|backpressure)/i,
    eventType: "INGA_QUEUE_FULL", severity: "warning",
    normalizedMeaning: "INGA event queue is saturated",
    relatedServices: ["inga", "mqtt"],
    correlationTags: ["inga", "queue_full"],
    suggestedTechCheck: "Confirm broker is consuming; do not drop the queue without snapshot.",
    rootCauseHint: "downstream-slow", delta: 6 },
  { service: "inga", re: /(downstream (integration )?(error|failure|unavailable))/i,
    eventType: "INGA_DOWNSTREAM_FAILURE", severity: "warning",
    normalizedMeaning: "INGA downstream integration failed",
    relatedServices: ["inga", "hl7", "ipconnect"],
    correlationTags: ["inga", "downstream"],
    suggestedTechCheck: "Inspect HL7 / IPConnect targets before touching INGA.",
    rootCauseHint: "downstream-integration", delta: 5 },

  // -------------------- Pulse Gateway --------------------
  { service: "pulse-gateway", re: /(mqtt disconnect|broker connection lost)/i,
    eventType: "PULSE_MQTT_DISCONNECTED", severity: "warning",
    normalizedMeaning: "Pulse Gateway lost connection to the MQTT broker",
    relatedServices: ["pulse-gateway", "mqtt"],
    correlationTags: ["pulse", "mqtt"],
    suggestedTechCheck: "Confirm broker reachable from Pulse Gateway VM. Do NOT restart Pulse Gateway first.",
    rootCauseHint: "mqtt-broker-down", delta: 12 },
  { service: "pulse-gateway", re: /(restarting .* \(\d+\)|backoff restarting failed container|container .* (exited|stopped) with code)/i,
    eventType: "PULSE_CONTAINER_RESTART_LOOP", severity: "critical",
    normalizedMeaning: "Pulse Gateway container is in a restart loop",
    relatedServices: ["pulse-gateway", "docker"],
    correlationTags: ["pulse", "container", "restart_loop"],
    suggestedTechCheck: "Capture `docker logs` for the failing container before restarting.",
    rootCauseHint: "pulse-crash-loop", delta: 18 },
  { service: "pulse-gateway", re: /(auth (failed|error)|authentication (failed|denied)|unauthorized)/i,
    eventType: "PULSE_AUTH_FAILED", severity: "warning",
    normalizedMeaning: "Pulse Gateway authentication rejected",
    relatedServices: ["pulse-gateway"],
    correlationTags: ["pulse", "auth"],
    suggestedTechCheck: "Verify API key / credentials supplied to Pulse Gateway.",
    rootCauseHint: "pulse-auth", delta: 8 },
  { service: "pulse-gateway", re: /(api .* (unavailable|5\d\d)|service unavailable)/i,
    eventType: "PULSE_API_UNAVAILABLE", severity: "warning",
    normalizedMeaning: "Pulse Gateway API is unavailable",
    relatedServices: ["pulse-gateway"],
    correlationTags: ["pulse", "api"],
    suggestedTechCheck: "Probe HTTPS health endpoint; check container state.",
    rootCauseHint: "pulse-api-down", delta: 10 },

  // -------------------- Pulse Manage --------------------
  { service: "pulse-manage", re: /(gateway (unreachable|unavailable))/i,
    eventType: "PMANAGE_GATEWAY_UNREACHABLE", severity: "warning",
    normalizedMeaning: "Pulse Manage cannot reach Pulse Gateway",
    relatedServices: ["pulse-manage", "pulse-gateway"],
    correlationTags: ["pulse-manage", "gateway"],
    suggestedTechCheck: "Check Pulse Gateway health before touching Pulse Manage.",
    rootCauseHint: "pulse-gateway-down", delta: 10 },
  { service: "pulse-manage", re: /(config sync (failed|error))/i,
    eventType: "PMANAGE_CONFIG_SYNC_FAILED", severity: "warning",
    normalizedMeaning: "Pulse Manage failed to sync configuration",
    relatedServices: ["pulse-manage"],
    correlationTags: ["pulse-manage", "config"],
    suggestedTechCheck: "Check Pulse Manage logs for the offending config payload.",
    rootCauseHint: "config-sync", delta: 5 },

  // -------------------- TLS / certs (any service) --------------------
  { service: "*", re: /(certificate (has )?expired|cert expired)/i,
    eventType: "CERT_EXPIRED", severity: "critical",
    normalizedMeaning: "TLS certificate has expired",
    relatedServices: ["tls"],
    correlationTags: ["tls", "cert"],
    suggestedTechCheck: "Renew TLS certificate; check NTP sync first.",
    rootCauseHint: "cert-expired", delta: 14 },
  { service: "*", re: /(tls|ssl) (handshake|alert|protocol).*(fail|error|fatal)/i,
    eventType: "TLS_HANDSHAKE_FAILED", severity: "warning",
    normalizedMeaning: "TLS handshake failed",
    relatedServices: ["tls"],
    correlationTags: ["tls"],
    suggestedTechCheck: "Validate cert chain and client trust store.",
    rootCauseHint: "tls", delta: 8 },

  // -------------------- HL7 --------------------
  { service: "hl7", re: /(mllp (connection )?(failed|refused|error))/i,
    eventType: "HL7_MLLP_FAILED", severity: "critical",
    normalizedMeaning: "MLLP connection to HL7 receiver failed",
    relatedServices: ["hl7"],
    correlationTags: ["hl7", "mllp"],
    suggestedTechCheck: "Check downstream HL7 receiver port (typically 2575).",
    rootCauseHint: "hl7-receiver-down", delta: 12 },
  { service: "hl7", re: /(ack (timeout|missing))/i,
    eventType: "HL7_ACK_TIMEOUT", severity: "warning",
    normalizedMeaning: "HL7 receiver did not ACK in time",
    relatedServices: ["hl7"],
    correlationTags: ["hl7", "ack"],
    suggestedTechCheck: "Inspect downstream HL7 receiver health.",
    rootCauseHint: "hl7-receiver-slow", delta: 6 },
  { service: "hl7", re: /\bnack\b/i,
    eventType: "HL7_NACK", severity: "warning",
    normalizedMeaning: "HL7 receiver returned a NACK",
    relatedServices: ["hl7"],
    correlationTags: ["hl7", "nack"],
    suggestedTechCheck: "Validate the rejected message structure.",
    rootCauseHint: "hl7-message", delta: 4 },
  { service: "hl7", re: /(socket closed|connection reset by peer|EPIPE)/i,
    eventType: "HL7_SOCKET_CLOSED", severity: "warning",
    normalizedMeaning: "HL7 socket closed by peer",
    relatedServices: ["hl7"],
    correlationTags: ["hl7"],
    suggestedTechCheck: "Check downstream availability and idle timeouts.",
    rootCauseHint: "hl7-receiver-flap", delta: 5 },
  { service: "hl7", re: /message (rejected|invalid)/i,
    eventType: "HL7_MESSAGE_REJECTED", severity: "warning",
    normalizedMeaning: "HL7 message rejected",
    relatedServices: ["hl7"],
    correlationTags: ["hl7"],
    suggestedTechCheck: "Validate the message structure against receiver expectations.",
    rootCauseHint: "hl7-message", delta: 3 },

  // -------------------- License --------------------
  { service: "*", re: /\blicense\b.*(expired|invalid|missing|unauthori[sz]ed)/i,
    eventType: "LICENSE_INVALID", severity: "critical",
    normalizedMeaning: "License is invalid, expired, or rejected",
    relatedServices: ["license", "ipconnect"],
    correlationTags: ["license"],
    suggestedTechCheck: "Verify License Service is up and reachable from this host.",
    rootCauseHint: "license", delta: 18 },
  { service: "*", re: /license server (unreachable|unavailable|timeout)/i,
    eventType: "LICENSE_SERVER_UNREACHABLE", severity: "critical",
    normalizedMeaning: "License server unreachable",
    relatedServices: ["license"],
    correlationTags: ["license", "network"],
    suggestedTechCheck: "Probe License Service endpoint; check route and firewall.",
    rootCauseHint: "license-server-down", delta: 14 },

  // -------------------- IPConnect / Webmin --------------------
  { service: "ipconnect", re: /controller (offline|unreachable)/i,
    eventType: "IPC_CONTROLLER_OFFLINE", severity: "critical",
    normalizedMeaning: "IPConnect reports a controller offline",
    relatedServices: ["ipconnect", "controller", "network"],
    correlationTags: ["controller", "ipconnect"],
    suggestedTechCheck: "Check PoE, switch port, and VLAN for the controller. Do NOT restart Pulse Gateway.",
    rootCauseHint: "controller-down", delta: 12 },
  { service: "ipconnect", re: /heartbeat (missed|timeout)/i,
    eventType: "IPC_HEARTBEAT_MISSED", severity: "warning",
    normalizedMeaning: "Controller heartbeat missed",
    relatedServices: ["controller", "ipconnect", "network"],
    correlationTags: ["controller", "heartbeat"],
    suggestedTechCheck: "Check PoE, switch port, VLAN. Do NOT restart Pulse Gateway.",
    rootCauseHint: "controller-down", delta: 8 },
  { service: "ipconnect", re: /config(uration)? mismatch/i,
    eventType: "IPC_CONFIG_MISMATCH", severity: "warning",
    normalizedMeaning: "IPConnect detected a config mismatch",
    relatedServices: ["ipconnect"],
    correlationTags: ["ipconnect", "config"],
    suggestedTechCheck: "Reload site config from CCP.",
    rootCauseHint: "config", delta: 4 },
  { service: "ipconnect", re: /(connection (lost|closed by peer))/i,
    eventType: "IPC_CONNECTION_LOST", severity: "warning",
    normalizedMeaning: "IPConnect lost a downstream connection",
    relatedServices: ["ipconnect", "network"],
    correlationTags: ["ipconnect", "network"],
    suggestedTechCheck: "Check L2/L3 path to the offending peer.",
    rootCauseHint: "network", delta: 5 },
  { service: "ipconnect", re: /(miniserv .*(down|stopped)|webmin (not running|down))/i,
    eventType: "WEBMIN_MINISERV_DOWN", severity: "critical",
    normalizedMeaning: "Webmin / MiniServ is not running",
    relatedServices: ["ipconnect"],
    correlationTags: ["webmin"],
    suggestedTechCheck: "Start webmin service (medium risk; capture state first).",
    rootCauseHint: "webmin-down", delta: 10 },
  { service: "ipconnect", re: /(invalid login|authentication (failure|failed))/i,
    eventType: "WEBMIN_AUTH_FAILURE", severity: "warning",
    normalizedMeaning: "Webmin authentication failure",
    relatedServices: ["ipconnect"],
    correlationTags: ["webmin", "auth"],
    suggestedTechCheck: "Confirm Webmin credentials and account lockout.",
    rootCauseHint: "webmin-auth", delta: 5 },

  // -------------------- RTLS --------------------
  { service: "rtls", re: /(badge .* (missing|not received|lost))/i,
    eventType: "RTLS_BADGE_MISSING", severity: "warning",
    normalizedMeaning: "RTLS badge events are missing",
    relatedServices: ["rtls"],
    correlationTags: ["rtls", "badge"],
    suggestedTechCheck: "Check RTLS gateway battery/coverage; do NOT replace badge yet.",
    rootCauseHint: "rtls-coverage", delta: 5 },
  { service: "rtls", re: /(room (resolver|lookup) (failed|error))/i,
    eventType: "RTLS_ROOM_RESOLVER_FAILED", severity: "warning",
    normalizedMeaning: "RTLS room resolver failed",
    relatedServices: ["rtls"],
    correlationTags: ["rtls", "config"],
    suggestedTechCheck: "Verify room map / config sync.",
    rootCauseHint: "rtls-config", delta: 4 },
  { service: "rtls", re: /(rtls )?gateway (disconnected|unreachable)/i,
    eventType: "RTLS_GATEWAY_DISCONNECTED", severity: "critical",
    normalizedMeaning: "RTLS gateway disconnected",
    relatedServices: ["rtls", "network"],
    correlationTags: ["rtls"],
    suggestedTechCheck: "Check RTLS gateway power/PoE and uplink.",
    rootCauseHint: "rtls-gateway-down", delta: 10 },

  // -------------------- Docker --------------------
  { service: "*", re: /container .* exited with code (?!0\b)\d+/i,
    eventType: "DOCKER_CONTAINER_EXITED", severity: "critical",
    normalizedMeaning: "Docker container exited with non-zero code",
    relatedServices: ["docker"],
    correlationTags: ["docker"],
    suggestedTechCheck: "Inspect `docker logs` for the failing container before restarting.",
    rootCauseHint: "container-crash", delta: 10 },
  { service: "*", re: /unhealthy: container/i,
    eventType: "DOCKER_UNHEALTHY", severity: "warning",
    normalizedMeaning: "Docker container reports unhealthy",
    relatedServices: ["docker"],
    correlationTags: ["docker"],
    suggestedTechCheck: "Check the container's healthcheck command and recent logs.",
    rootCauseHint: "container-unhealthy", delta: 6 },

  // -------------------- Controller / generic network --------------------
  { service: "controller", re: /(ping (failed|timeout)|destination host unreachable|request timed out)/i,
    eventType: "CONTROLLER_PING_FAIL", severity: "warning",
    normalizedMeaning: "Controller is not responding to ping",
    relatedServices: ["controller", "network"],
    correlationTags: ["controller", "ping"],
    suggestedTechCheck: "Check PoE, switch port, VLAN. Do NOT restart Pulse Gateway.",
    rootCauseHint: "controller-down", delta: 8 },
  { service: "controller", re: /(stale heartbeat|controller silent|no event traffic)/i,
    eventType: "CONTROLLER_STALE", severity: "warning",
    normalizedMeaning: "Controller is silent — parent IPC may be healthy but controller stopped reporting",
    relatedServices: ["controller", "ipconnect"],
    correlationTags: ["controller", "stale"],
    suggestedTechCheck: "Confirm parent IPC is alive, then check switch port / PoE for the controller.",
    rootCauseHint: "controller-down", delta: 6 },
];

function ruleApplies(rule, service) {
  return rule.service === "*" || rule.service === service;
}

function classifyLine(line, service) {
  for (const rule of RULES) {
    if (!ruleApplies(rule, service)) continue;
    if (rule.re.test(line)) return rule;
  }
  return null;
}

/**
 * Normalize a window of raw log lines for a single device.
 */
export function normalizeLogLines({ deviceProfile = null, deviceId = null, lines = [], sourcePath = null } = {}) {
  const service = canonicalServiceFor(deviceProfile);
  const events = [];
  const limit = Math.min(lines.length, 1000);
  for (let i = 0; i < limit; i++) {
    const raw = String(lines[i] || "");
    if (!raw.trim()) continue;
    const rule = classifyLine(raw, service);
    if (!rule) continue;
    events.push({
      timestamp: extractTimestamp(raw),
      sourceService: rule.service === "*" ? service : rule.service,
      sourceDeviceId: deviceId,
      sourcePath: sourcePath || null,
      severity: rule.severity,
      eventType: rule.eventType,
      rawLine: raw.length > 600 ? raw.slice(0, 600) + "…" : raw,
      normalizedMeaning: rule.normalizedMeaning,
      relatedServices: rule.relatedServices.slice(),
      confidenceImpact: { rootCauseHint: rule.rootCauseHint, delta: rule.delta },
      correlationTags: rule.correlationTags.slice(),
      suggestedTechCheck: rule.suggestedTechCheck,
      line: i + 1,
    });
  }
  return { events, service, sourcePath };
}

export function listNormalizerRules() {
  return RULES.map((r) => ({
    eventType: r.eventType, service: r.service, severity: r.severity,
    meaning: r.normalizedMeaning,
  }));
}