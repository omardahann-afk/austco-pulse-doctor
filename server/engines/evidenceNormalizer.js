/**
 * evidenceNormalizer.js
 * 
 * Converts raw agent text blobs into structured evidence objects.
 * This is the first stage of the causal pipeline.
 * 
 * Input:  raw agent payload (giant text blobs)
 * Output: structured evidence events with type, severity, timestamp, source
 */

// ─── Pattern library — every known Tacera failure signature ──────────────────

const PATTERNS = [

  // Transport / TCP failures
  { type: 'PST_TCP_FAILURE',       severity: 'CRITICAL', weight: 100,
    re: /TCP socket connection is unsuccessful|connect\(\) failed|transport.*fail|socket.*fail/i,
    layer: 'transport', component: 'pst' },

  { type: 'CONNECTION_REFUSED',    severity: 'HIGH',     weight: 70,
    re: /connection refused|ECONNREFUSED/i,
    layer: 'transport', component: 'service' },

  { type: 'TIMEOUT',               severity: 'MEDIUM',   weight: 50,
    re: /timed? ?out|timeout|ETIMEDOUT/i,
    layer: 'transport', component: 'unknown' },

  // XmlBlaster / IPConnect
  { type: 'XMLBLASTER_DISCONNECT', severity: 'CRITICAL', weight: 92,
    re: /XmlBlaster.*disconnect|xmlBlaster.*session.*down|xmlBlaster.*lost|Cannot connect to XmlBlaster|20301/i,
    layer: 'application', component: 'ipconnect' },

  { type: 'XMLBLASTER_RECONNECT',  severity: 'INFO',     weight: 10,
    re: /XmlBlaster.*reconnect|xmlBlaster.*restored/i,
    layer: 'application', component: 'ipconnect' },

  { type: 'WATCHDOG_FAILURE',      severity: 'HIGH',     weight: 80,
    re: /watchdog|XCareServer.*died|ipconnect.*watchdog/i,
    layer: 'application', component: 'ipconnect' },

  // License / Plugin
  { type: 'LICENSE_PLUGIN_FAILURE', severity: 'CRITICAL', weight: 95,
    re: /pluginFailed|license.*fail|license.*invalid|license.*expired|IPC-SMA|LMX.*error|violation/i,
    layer: 'licensing', component: 'license_service' },

  { type: 'LICENSE_DEFERRED',      severity: 'MEDIUM',   weight: 40,
    re: /license.*defer|grace period|deferred.*start/i,
    layer: 'licensing', component: 'license_service' },

  // Certificate / TLS
  { type: 'CERT_FAILURE',          severity: 'CRITICAL', weight: 93,
    re: /PKIX|SSLHandshake|CertificateExpir|x509|ssl.*fail|tls.*fail|trust.*fail/i,
    layer: 'security', component: 'certificates' },

  // Callpoint / Signal Mapping
  { type: 'INVALID_CALLPOINT',     severity: 'CRITICAL', weight: 94,
    re: /Invalid call point ID|invalid.*signal.*attr|Could not interpret new update|10119/i,
    layer: 'configuration', component: 'ccp' },

  { type: 'BAD_MESSAGE',           severity: 'HIGH',     weight: 75,
    re: /BAD message|bad.*callpoint|malformed.*event/i,
    layer: 'configuration', component: 'ccp' },

  // RTLS / Presence
  { type: 'RTLS_FAILURE',          severity: 'HIGH',     weight: 70,
    re: /RTLS.*fail|badge.*expir|presence.*clear|staff.*presence.*fail/i,
    layer: 'rtls', component: 'rtls_gateway' },

  { type: 'PRESENCE_CLEARED',      severity: 'HIGH',     weight: 72,
    re: /presence.*cleared|staff.*cleared|badge.*lost/i,
    layer: 'rtls', component: 'rtls_gateway' },

  // Docker / Infrastructure
  { type: 'DOCKER_BRIDGE_FAILURE', severity: 'CRITICAL', weight: 98,
    re: /austco_bridge.*fail|network.*bridge.*down|docker.*network.*error/i,
    layer: 'infrastructure', component: 'docker' },

  { type: 'DOCKER_CONTAINER_DOWN', severity: 'HIGH',     weight: 80,
    re: /container.*exited|container.*stopped|docker.*down/i,
    layer: 'infrastructure', component: 'docker' },

  // ODL / Display
  { type: 'ODL_DEGRADED',          severity: 'HIGH',     weight: 68,
    re: /ODL.*degrad|display.*fail|annunciator.*fail|nurse.*station.*fail/i,
    layer: 'display', component: 'odl' },

  // WebSocket / INGA
  { type: 'WEBSOCKET_FAILURE',     severity: 'HIGH',     weight: 65,
    re: /WebSocket.*fail|websocket.*session.*down|Closing WebSocket.*fatal|Unknown websocket/i,
    layer: 'application', component: 'inga' },

  { type: 'INGA_WARNING',          severity: 'MEDIUM',   weight: 45,
    re: /10201|10202|10236|10330|10119|20303/,
    layer: 'application', component: 'inga' },

  // Database
  { type: 'DB_FAILURE',            severity: 'CRITICAL', weight: 90,
    re: /postgres.*down|database.*fail|could not connect.*5432|pg.*error/i,
    layer: 'database', component: 'postgresql' },

  // Disk / System
  { type: 'DISK_FULL',             severity: 'CRITICAL', weight: 88,
    re: /no space left|disk full|filesystem.*full/i,
    layer: 'system', component: 'disk' },

  { type: 'SERVICE_FAILED',        severity: 'HIGH',     weight: 78,
    re: /systemctl.*failed|service.*failed|unit.*failed/i,
    layer: 'system', component: 'systemd' },

  // Disconnect / Reconnect storms
  { type: 'DISCONNECT_STORM',      severity: 'HIGH',     weight: 60,
    re: /disconnect|DISCONNECT/,
    layer: 'transport', component: 'unknown' },

  { type: 'RECONNECT',             severity: 'INFO',     weight: 5,
    re: /reconnect|RECONNECT/,
    layer: 'transport', component: 'unknown' },

  // Webmin operations (NOT errors — confirm these are success messages)
  { type: 'WEBMIN_OP',             severity: 'INFO',     weight: 0,
    re: /was run with no error|webmin.*exec|addDnsEntry|vpnStart|manage-app/i,
    layer: 'admin', component: 'webmin' },
];

// ─── Timestamp extractor ─────────────────────────────────────────────────────

function extractTimestamp(line) {
  const patterns = [
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
    /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
    /(\d{2}:\d{2}:\d{2})/,
  ];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Component refiner — improve component detection from context ─────────────

function refineComponent(line, baseComponent) {
  if (/\[IPConnect\]|xcare|xmlBlaster/i.test(line)) return 'ipconnect';
  if (/\[INGA\]|integration-gateway|InGa/i.test(line)) return 'inga';
  if (/\[PST\]|ip_pst|pst.*log/i.test(line)) return 'pst';
  if (/\[RTLSGateway\]|rtls/i.test(line)) return 'rtls_gateway';
  if (/\[MoGa\]|mobilegateway/i.test(line)) return 'mobile_gateway';
  if (/pulse.gateway|nginx/i.test(line)) return 'pulse_gateway';
  if (/license/i.test(line)) return 'license_service';
  if (/docker/i.test(line)) return 'docker';
  return baseComponent;
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

/**
 * Normalize a raw agent payload into structured evidence events.
 * @param {object} payload - raw agent POST body
 * @returns {object} - { host, ip, role, events[], summary }
 */
export function normalizeAgentPayload(payload) {
  const { host, ip, role, timestamp: payloadTs, health = {}, tacera = {}, meaningHint } = payload;

  // Collect all text blobs to scan
  const textSources = [
    { key: 'journal',         text: health.journal || '' },
    { key: 'failedServices',  text: health.failedServices || '' },
    { key: 'webmin',          text: health.webmin || '' },
    { key: 'pstLog',          text: tacera.pstLogTail || '' },
    { key: 'importantErrors', text: tacera.importantErrors || '' },
    { key: 'importantEvents', text: tacera.importantEvents || '' },
    { key: 'processes',       text: health.processes || '' },
    { key: 'docker',          text: health.docker || '' },
    { key: 'ports',           text: health.ports || '' },
  ];

  const events = [];
  const seen = new Set(); // dedup identical events

  for (const { key, text } of textSources) {
    if (!text || typeof text !== 'string') continue;
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 10) continue;

      for (const pattern of PATTERNS) {
        if (!pattern.re.test(trimmed)) continue;

        const ts = extractTimestamp(trimmed) || payloadTs;
        const component = refineComponent(trimmed, pattern.component);
        const dedupeKey = `${pattern.type}:${trimmed.slice(0, 80)}`;

        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        events.push({
          type: pattern.type,
          severity: pattern.severity,
          weight: pattern.weight,
          layer: pattern.layer,
          component,
          source: key,
          timestamp: ts,
          raw: trimmed.slice(0, 300),
          host,
          ip,
          role,
        });

        break; // first matching pattern wins
      }
    }
  }

  // Parse structured health fields
  const structured = parseStructuredHealth(health, host, ip, role, payloadTs);

  // Combine and sort by weight desc (most significant first)
  const allEvents = [...events, ...structured].sort((a, b) => (b.weight || 0) - (a.weight || 0));

  // Build summary counts
  const summary = {
    total: allEvents.length,
    critical: allEvents.filter(e => e.severity === 'CRITICAL').length,
    high: allEvents.filter(e => e.severity === 'HIGH').length,
    medium: allEvents.filter(e => e.severity === 'MEDIUM').length,
    info: allEvents.filter(e => e.severity === 'INFO').length,
    topType: allEvents[0]?.type || null,
    topWeight: allEvents[0]?.weight || 0,
  };

  return { host, ip, role, receivedAt: new Date().toISOString(), events: allEvents, summary };
}

// ─── Structured health parser ─────────────────────────────────────────────────

function parseStructuredHealth(health, host, ip, role, ts) {
  const events = [];

  // Docker containers
  if (health.docker && typeof health.docker === 'string') {
    const expectedContainers = ['pulse-gateway', 'config-api', 'license-service', 'annunciator', 'nursestation'];
    for (const name of expectedContainers) {
      if (!health.docker.includes(name)) {
        events.push({
          type: 'DOCKER_CONTAINER_MISSING',
          severity: name === 'pulse-gateway' || name === 'config-api' ? 'CRITICAL' : 'HIGH',
          weight: name === 'pulse-gateway' ? 95 : 75,
          layer: 'infrastructure',
          component: 'docker',
          source: 'docker_structured',
          timestamp: ts,
          raw: `Container '${name}' not found in docker ps output`,
          host, ip, role,
          detail: { container: name },
        });
      } else if (health.docker.match(new RegExp(`${name}.*Exited`))) {
        events.push({
          type: 'DOCKER_CONTAINER_EXITED',
          severity: 'HIGH',
          weight: 82,
          layer: 'infrastructure',
          component: 'docker',
          source: 'docker_structured',
          timestamp: ts,
          raw: `Container '${name}' has exited`,
          host, ip, role,
          detail: { container: name },
        });
      }
    }
  }

  // Failed systemd services
  if (health.failedServices && typeof health.failedServices === 'string') {
    const lines = health.failedServices.split('\n').filter(l => l.includes('failed'));
    for (const line of lines) {
      events.push({
        type: 'SERVICE_FAILED',
        severity: 'HIGH',
        weight: 78,
        layer: 'system',
        component: 'systemd',
        source: 'failedServices_structured',
        timestamp: ts,
        raw: line.trim().slice(0, 200),
        host, ip, role,
      });
    }
  }

  // Disk usage
  if (health.disk && typeof health.disk === 'string') {
    const matches = [...health.disk.matchAll(/(\d+)%\s+(\S+)/g)];
    for (const [, pct, mount] of matches) {
      const p = parseInt(pct);
      if (p > 90) {
        events.push({
          type: 'DISK_CRITICAL',
          severity: 'CRITICAL',
          weight: 88,
          layer: 'system',
          component: 'disk',
          source: 'disk_structured',
          timestamp: ts,
          raw: `Disk ${mount} at ${pct}% — critically full`,
          host, ip, role,
          detail: { mount, percent: p },
        });
      } else if (p > 80) {
        events.push({
          type: 'DISK_WARNING',
          severity: 'HIGH',
          weight: 65,
          layer: 'system',
          component: 'disk',
          source: 'disk_structured',
          timestamp: ts,
          raw: `Disk ${mount} at ${pct}% — approaching full`,
          host, ip, role,
          detail: { mount, percent: p },
        });
      }
    }
  }

  return events;
}
