/**
 * causalEngine.js
 *
 * Determines what failed FIRST and reconstructs the full cascade.
 *
 * The only correct output is:
 *   "X failed first → Y collapsed → Z degraded → field symptoms appeared"
 *
 * NOT: "multiple issues detected" or "insufficient evidence"
 */

// ─── Causal rules — ordered by what causes what ──────────────────────────────
// Each rule: if pattern A is seen BEFORE pattern B, A caused B.
// Weight = confidence this is the root cause when seen first.

const CAUSAL_CHAIN_RULES = [
  // Rule 1: PST TCP failure → XmlBlaster collapse (highest priority chain)
  {
    id: 'PST_TCP_TRANSPORT_CHAIN',
    rank: 100,
    rootCause: 'PST_TCP_FAILURE',
    rootLabel: 'PST TCP transport socket failure',
    cascade: [
      { type: 'XMLBLASTER_DISCONNECT', label: 'XmlBlaster session disconnected' },
      { type: 'PRESENCE_CLEARED',      label: 'Staff presence cleared' },
      { type: 'ODL_DEGRADED',          label: 'ODL/display degraded' },
    ],
    humanExplanation: 'The PST device lost its outbound TCP transport before XmlBlaster collapsed. This is the origin — not the disconnect.',
    nextStep: 'Verify upstream IPC target IP, route, subnet, and that IP-Connect is listening on its configured port.',
    verification: 'Confirm PST socket failures stopped after route/IPC correction.',
  },

  // Rule 2: License plugin failure → IP-Connect forced shutdown
  {
    id: 'LICENSE_PLUGIN_CHAIN',
    rank: 95,
    rootCause: 'LICENSE_PLUGIN_FAILURE',
    cascade: [
      { type: 'XMLBLASTER_DISCONNECT', label: 'XmlBlaster forced shutdown by license violation' },
      { type: 'WEBSOCKET_FAILURE',     label: 'WebSocket sessions dropped' },
    ],
    rootLabel: 'License plugin failure forced IP-Connect shutdown',
    humanExplanation: 'LMX license check failed. IP-Connect shut down (ACSSOFT-9082 — does not auto-restart on violation). All downstream services lost their XmlBlaster connection.',
    nextStep: 'Check /home/xcare/runtime/lmx/logs/lmx-serv.log and license file validity. Verify dmidecode UUID matches license host ID.',
    verification: 'IP-Connect restarts cleanly and license validity shows green in Webmin.',
  },

  // Rule 3: Certificate failure → service-wide TLS collapse
  {
    id: 'CERT_CHAIN',
    rank: 93,
    rootCause: 'CERT_FAILURE',
    cascade: [
      { type: 'CONNECTION_REFUSED',    label: 'Services refusing secure connections' },
      { type: 'WEBSOCKET_FAILURE',     label: 'WebSocket sessions failing TLS handshake' },
    ],
    rootLabel: 'Certificate/TLS validation failure',
    humanExplanation: 'AustcoLocal.crt is expired or the Java truststore rejected the certificate. All HTTPS-dependent services (INGA, Pulse Gateway, Pulse Manage, License API) refuse connections.',
    nextStep: 'Run: openssl x509 -enddate -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt. Also check VM system time — wrong clock makes valid certs appear expired.',
    verification: 'Certificate enddate is in the future and system time is correct.',
  },

  // Rule 4: Invalid callpoint mapping → INGA translation failures
  {
    id: 'CALLPOINT_MAPPING_CHAIN',
    rank: 94,
    rootCause: 'INVALID_CALLPOINT',
    cascade: [
      { type: 'WEBSOCKET_FAILURE',     label: 'WebSocket session instability from bad events' },
      { type: 'BAD_MESSAGE',           label: 'Bad messages accumulating in event queue' },
    ],
    rootLabel: 'Invalid callpoint ID or signal mapping mismatch',
    humanExplanation: 'INGA is receiving callpoint events that do not match its loaded CCP configuration. This is a config/CCP mismatch, not a network problem. The IDs exist in the controller but not in the CCP loaded by INGA.',
    nextStep: 'Compare affected callpoint IDs against CCP loaded in INGA. Check for recent CCP upload or controller reconfiguration.',
    verification: 'Invalid callpoint errors stop appearing in integration-gateway logs.',
  },

  // Rule 5: Docker bridge failure → all services simultaneous
  {
    id: 'DOCKER_BRIDGE_CHAIN',
    rank: 98,
    rootCause: 'DOCKER_BRIDGE_FAILURE',
    cascade: [
      { type: 'DOCKER_CONTAINER_DOWN', label: 'All Docker containers lost network' },
      { type: 'CONNECTION_REFUSED',    label: 'Inter-service connections refused' },
    ],
    rootLabel: 'austco_bridge Docker network failure',
    humanExplanation: 'The Docker bridge network failed (known to occur after VPN activation). ALL Docker services — Pulse Gateway, config-api, license-service, annunciator, nursestation — lost connectivity simultaneously. This is the only scenario where all services fail at exactly the same time.',
    nextStep: 'Run: docker network inspect austco_bridge. If missing: docker network create --driver bridge austco_bridge, then restart containers.',
    verification: 'docker network inspect austco_bridge shows all containers attached.',
  },

  // Rule 6: DB failure → all application services fail
  {
    id: 'DATABASE_CHAIN',
    rank: 90,
    rootCause: 'DB_FAILURE',
    cascade: [
      { type: 'LICENSE_PLUGIN_FAILURE', label: 'License service cannot read licensing DB' },
      { type: 'DOCKER_CONTAINER_DOWN', label: 'Pulse Manage loses config DB' },
    ],
    rootLabel: 'PostgreSQL database failure',
    humanExplanation: 'PostgreSQL at 127.0.0.2:5432 is unreachable. All Tacera databases (eventlog, config, licensing, moga, rtls) are inaccessible. Tacera services will fail to start or crash.',
    nextStep: 'sudo service postgresql start. Then check /home/xcare/db/data/postgresql.conf timezone = \'localtime\'.',
    verification: 'psql -h 127.0.0.2 -c "\\l" returns database list.',
  },

  // Rule 7: Disk full → services failing silently
  {
    id: 'DISK_CHAIN',
    rank: 88,
    rootCause: 'DISK_FULL',
    cascade: [
      { type: 'SERVICE_FAILED',        label: 'Services cannot write logs or temp files' },
      { type: 'DB_FAILURE',            label: 'PostgreSQL cannot write WAL files' },
    ],
    rootLabel: 'Disk full — system-wide service degradation',
    humanExplanation: 'Root or application filesystem is full. Services that cannot write logs, temp files, or database WAL entries will crash silently or refuse to start.',
    nextStep: 'df -h to confirm. Check /var/log/ and /home/xcare/runtime/ for large files. Truncate (do not delete) active log files.',
    verification: 'df -h shows >20% free on all mounts.',
  },

  // Rule 8: Watchdog failure → IP-Connect restart cycle
  {
    id: 'WATCHDOG_CHAIN',
    rank: 80,
    rootCause: 'WATCHDOG_FAILURE',
    cascade: [
      { type: 'XMLBLASTER_DISCONNECT', label: 'XmlBlaster lost during watchdog-triggered restart' },
      { type: 'DISCONNECT_STORM',      label: 'Disconnect storm as clients reconnect' },
    ],
    rootLabel: 'IP-Connect watchdog triggered restart cycle',
    humanExplanation: 'The XCareServer watchdog detected an internal fault and triggered a restart. All connected clients disconnected during restart. The watchdog event is the root cause, not the subsequent disconnects.',
    nextStep: 'Check /var/opt/xcare/log/xcare00.log for the watchdog trigger reason just before the disconnect.',
    verification: 'IP-Connect restarts cleanly with no further watchdog events.',
  },

  // Rule 9: WebSocket failure (without prior transport failure) — INGA issue
  {
    id: 'WEBSOCKET_INGA_CHAIN',
    rank: 65,
    rootCause: 'WEBSOCKET_FAILURE',
    cascade: [
      { type: 'ODL_DEGRADED',          label: 'Display devices lost event feed' },
    ],
    rootLabel: 'Integration Gateway WebSocket session failure',
    humanExplanation: 'INGA WebSocket sessions are failing without a prior transport failure — this points to INGA itself, not the network. Possible causes: INGA out of memory, certificate issue, or upstream XmlBlaster not responding.',
    nextStep: 'Check INGA process (pgrep -f integration-gateway.war). Check /home/xcare/runtime/integration-gateway/logs/app.log for root error.',
    verification: 'WebSocket sessions stable — no more Closing WebSocket fatal error entries.',
  },
];

// ─── Timeline reconstructor ──────────────────────────────────────────────────

/**
 * Given normalised events from one or more hosts, reconstruct causal timeline.
 * Returns the single most likely root cause with full cascade.
 */
export function buildCausalTimeline(allEvents = []) {
  if (!allEvents.length) return emptyResult();

  // Sort events by timestamp (oldest first = what happened first)
  const sorted = [...allEvents]
    .filter(e => e.severity !== 'INFO' || e.type === 'WEBMIN_OP')
    .sort((a, b) => {
      const ta = parseTs(a.timestamp);
      const tb = parseTs(b.timestamp);
      return ta - tb;
    });

  // Find which causal rule matches best
  let bestRule = null;
  let bestScore = 0;
  let bestRootEvent = null;

  for (const rule of CAUSAL_CHAIN_RULES) {
    // Find first occurrence of the root cause type
    const rootEvent = sorted.find(e => e.type === rule.rootCause);
    if (!rootEvent) continue;

    // Check how many cascade events appear AFTER the root
    const rootTs = parseTs(rootEvent.timestamp);
    const cascadeMatches = rule.cascade.filter(c =>
      sorted.some(e => e.type === c.type && parseTs(e.timestamp) >= rootTs)
    );

    // Score = rule rank + cascade match bonus
    const score = rule.rank + (cascadeMatches.length * 5);

    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
      bestRootEvent = rootEvent;
    }
  }

  if (!bestRule) {
    // No causal chain matched — return the highest-weight single event
    const top = sorted.filter(e => e.weight > 0)[0];
    if (!top) return emptyResult();
    return {
      ok: true,
      confidence: 35,
      rootCauseType: top.type,
      rootCauseLabel: formatType(top.type),
      rootCauseEvent: top,
      humanExplanation: `${top.raw}`,
      cascade: [],
      nextStep: 'Collect more evidence — pull logs from all affected services.',
      verification: null,
      allEvents: sorted,
      chain: CAUSAL_CHAIN_RULES,
    };
  }

  // Build confirmed cascade (events that actually occurred after root)
  const rootTs = parseTs(bestRootEvent.timestamp);
  const confirmedCascade = bestRule.cascade
    .map(c => {
      const event = sorted.find(e => e.type === c.type && parseTs(e.timestamp) >= rootTs);
      return { ...c, confirmed: !!event, event: event || null };
    });

  // Confidence: base from rule rank, adjusted for cascade confirmation
  const cascadeScore = confirmedCascade.filter(c => c.confirmed).length / Math.max(bestRule.cascade.length, 1);
  const confidence = Math.min(99, Math.round(bestRule.rank * 0.8 + cascadeScore * 20));

  // Collect symptoms (events that are NOT the root cause and NOT in cascade)
  const cascadeTypes = new Set(bestRule.cascade.map(c => c.type));
  const symptoms = sorted.filter(e =>
    e.type !== bestRule.rootCause &&
    !cascadeTypes.has(e.type) &&
    e.severity !== 'INFO'
  ).slice(0, 5);

  return {
    ok: true,
    confidence,
    rootCauseType: bestRule.rootCause,
    rootCauseLabel: bestRule.rootLabel,
    rootCauseEvent: bestRootEvent,
    humanExplanation: bestRule.humanExplanation,
    cascade: confirmedCascade,
    symptoms,
    nextStep: bestRule.nextStep,
    verification: bestRule.verification,
    allEvents: sorted,
    ruleId: bestRule.id,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTs(ts) {
  if (!ts) return 0;
  try { return new Date(ts).getTime(); } catch { return 0; }
}

function formatType(type) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function emptyResult() {
  return {
    ok: false,
    confidence: 0,
    rootCauseType: null,
    rootCauseLabel: 'No root cause detected',
    humanExplanation: 'No significant events found in agent evidence. Ensure agents are collecting logs and the system is experiencing the issue.',
    cascade: [],
    nextStep: 'Verify agents are running and POSTing to /api/agent/ingest.',
    verification: null,
    allEvents: [],
  };
}
