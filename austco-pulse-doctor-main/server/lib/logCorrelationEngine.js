/**
 * Deterministic log correlation engine.
 * No AI. Pure regex/rule pattern matching.
 *
 * Input:  { lines, deviceProfile, probeResult, timestamp, deviceId }
 * Output: { correlatedEvents: [...], suspectedPatterns: [...] }
 */

const PATTERNS = [
  // MQTT
  { id: "mqtt.connection_refused", layer: "mqtt", severity: "critical", title: "MQTT connection refused", re: /(ECONNREFUSED|connection refused|broker unavailable)/i, recommendedNextCheck: "Verify mosquitto service is running on broker host (port 1883)." },
  { id: "mqtt.client_disconnected", layer: "mqtt", severity: "warning", title: "MQTT client disconnected", re: /(client disconnected|disconnected from broker|connection lost to broker)/i, recommendedNextCheck: "Check broker uptime and network path." },
  { id: "mqtt.tls_handshake_failed", layer: "mqtt", severity: "critical", title: "MQTT TLS handshake failed", re: /(tls handshake (failed|error)|ssl handshake)/i, recommendedNextCheck: "Validate broker TLS cert and client trust store." },
  { id: "mqtt.no_route", layer: "network", severity: "critical", title: "No route to broker host", re: /no route to host/i, recommendedNextCheck: "Check L3 routing / firewall between client and broker." },
  { id: "mqtt.subscribe_failed", layer: "mqtt", severity: "warning", title: "MQTT subscribe failed", re: /subscribe (failed|error|denied)/i, recommendedNextCheck: "Check broker ACLs and topic permissions." },
  { id: "mqtt.publish_failed", layer: "mqtt", severity: "warning", title: "MQTT publish failed", re: /publish (failed|error)/i, recommendedNextCheck: "Check broker disk space and ACLs." },
  { id: "mqtt.ack_timeout", layer: "mqtt", severity: "warning", title: "MQTT ACK timeout", re: /(ack timeout|puback timeout|publish (timed ?out|no ack))/i, recommendedNextCheck: "Increase keepalive or check broker load." },

  // Pulse Gateway
  { id: "pulse.container_exited", layer: "container", severity: "critical", title: "Container exited", re: /container .* (exited|stopped) with code/i, recommendedNextCheck: "docker ps -a; docker logs <container>." },
  { id: "pulse.db_locked", layer: "database", severity: "critical", title: "Database locked", re: /(database is locked|sqlite_busy)/i, recommendedNextCheck: "Identify the long-running writer; restart pulse-gateway if safe." },
  { id: "pulse.mqtt_disconnected", layer: "mqtt", severity: "warning", title: "Pulse Gateway MQTT disconnected", re: /(mqtt disconnect|broker connection lost)/i, recommendedNextCheck: "Confirm broker reachable from Pulse Gateway VM." },
  { id: "pulse.auth_failed", layer: "auth", severity: "warning", title: "Auth failed", re: /(auth (failed|error)|authentication (failed|denied)|unauthorized)/i, recommendedNextCheck: "Check credentials / API key." },
  { id: "pulse.cert_expired", layer: "tls", severity: "critical", title: "Certificate expired", re: /(certificate (has )?expired|cert expired)/i, recommendedNextCheck: "Renew TLS certificate." },
  { id: "pulse.docker_restart_loop", layer: "container", severity: "critical", title: "Docker restart loop", re: /(restarting .* \(\d+\)|backoff restarting failed container)/i, recommendedNextCheck: "Inspect crash reason in container logs." },

  // INGA
  { id: "inga.publish_no_ack", layer: "integration", severity: "warning", title: "INGA publish no ACK", re: /(failed to publish|publish .* no ack|publish timed out)/i, recommendedNextCheck: "Check broker first, then INGA queue depth." },
  { id: "inga.broker_unreachable", layer: "mqtt", severity: "critical", title: "INGA broker unreachable", re: /(broker (unreachable|unavailable))/i, recommendedNextCheck: "Confirm broker is up before restarting INGA." },
  { id: "inga.queue_full", layer: "integration", severity: "warning", title: "Event queue full", re: /(event queue full|queue overflow|backpressure)/i, recommendedNextCheck: "Drain queue or restart broker if dropped." },
  { id: "inga.integration_error", layer: "integration", severity: "warning", title: "Integration error", re: /integration error/i, recommendedNextCheck: "Check downstream HL7 / IPConnect." },

  // IPConnect
  { id: "ipc.controller_offline", layer: "controller", severity: "critical", title: "Controller offline", re: /controller (offline|unreachable)/i, recommendedNextCheck: "Check PoE / switch port for the controller, do not restart VM." },
  { id: "ipc.connection_lost", layer: "network", severity: "warning", title: "Connection lost", re: /connection (lost|closed by peer)/i, recommendedNextCheck: "Check L2/L3 path." },
  { id: "ipc.config_mismatch", layer: "config", severity: "warning", title: "Config mismatch", re: /config(uration)? mismatch/i, recommendedNextCheck: "Reload site config from CCP." },
  { id: "ipc.license_invalid", layer: "license", severity: "critical", title: "License invalid", re: /(license (invalid|expired|missing))/i, recommendedNextCheck: "Verify License Service is up and reachable." },
  { id: "ipc.heartbeat_missed", layer: "controller", severity: "warning", title: "Heartbeat missed", re: /(heartbeat (missed|timeout))/i, recommendedNextCheck: "Inspect controller; do not auto-restart VM." },

  // HL7
  { id: "hl7.mllp_failed", layer: "hl7", severity: "critical", title: "MLLP connection failed", re: /(mllp (connection )?(failed|error|refused))/i, recommendedNextCheck: "Check downstream HL7 receiver port." },
  { id: "hl7.ack_timeout", layer: "hl7", severity: "warning", title: "HL7 ACK timeout", re: /(ack (timeout|missing)|nack received)/i, recommendedNextCheck: "Inspect downstream HL7 receiver." },
  { id: "hl7.message_rejected", layer: "hl7", severity: "warning", title: "HL7 message rejected", re: /message (rejected|invalid)/i, recommendedNextCheck: "Validate message structure." },
  { id: "hl7.socket_closed", layer: "hl7", severity: "warning", title: "Socket closed by peer", re: /(socket closed|connection reset by peer|EPIPE)/i, recommendedNextCheck: "Check downstream availability." },

  // Webmin
  { id: "webmin.miniserv_down", layer: "service", severity: "critical", title: "Webmin / MiniServ down", re: /(miniserv .*(down|stopped)|webmin (not running|down))/i, recommendedNextCheck: "Restart webmin service (medium risk)." },
  { id: "webmin.tls_issue", layer: "tls", severity: "warning", title: "Webmin TLS issue", re: /(ssl|tls) (error|alert|handshake)/i, recommendedNextCheck: "Check /var/webmin/miniserv.log for cert errors." },
  { id: "webmin.auth_failure", layer: "auth", severity: "warning", title: "Webmin auth failure", re: /(invalid login|authentication (failure|failed))/i, recommendedNextCheck: "Confirm Webmin credentials and account lockout state." },
  { id: "webmin.permission_denied", layer: "fs", severity: "warning", title: "Permission denied", re: /permission denied/i, recommendedNextCheck: "Check file permissions on referenced path." },

  // Controller / generic
  { id: "controller.ping_failed", layer: "controller", severity: "warning", title: "Ping failed", re: /(ping (failed|timeout)|destination host unreachable)/i, recommendedNextCheck: "Check switch port and PoE." },
  { id: "controller.stale_heartbeat", layer: "controller", severity: "warning", title: "Stale heartbeat", re: /(stale heartbeat|controller silent)/i, recommendedNextCheck: "Confirm parent IPC is alive before touching controller." },
];

function newEventId() {
  return "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function correlateLogs({ lines = [], deviceProfile = null, probeResult = null, timestamp = null, deviceId = null } = {}) {
  const events = [];
  const seen = new Map();
  const limit = Math.min(lines.length, 500);
  for (let i = 0; i < limit; i++) {
    const line = String(lines[i] || "");
    if (!line) continue;
    for (const p of PATTERNS) {
      if (!p.re.test(line)) continue;
      const bucket = seen.get(p.id) || { count: 0, evidence: [] };
      bucket.count += 1;
      if (bucket.evidence.length < 3) bucket.evidence.push(line.slice(0, 280));
      seen.set(p.id, bucket);
    }
  }
  for (const [id, bucket] of seen.entries()) {
    const p = PATTERNS.find((x) => x.id === id);
    if (!p) continue;
    const confidence = bucket.count >= 3 ? "high" : bucket.count === 2 ? "medium" : "low";
    events.push({
      eventId: newEventId(),
      createdAt: new Date().toISOString(),
      deviceId,
      deviceProfile,
      patternId: p.id,
      title: p.title,
      severity: p.severity,
      likelyLayer: p.layer,
      confidence,
      occurrences: bucket.count,
      evidenceLines: bucket.evidence,
      explanation: `Pattern '${p.id}' matched ${bucket.count} time(s) in recent log window.`,
      recommendedNextCheck: p.recommendedNextCheck,
      probeContext: probeResult ? { ok: probeResult.ok, error: probeResult.error || null, latencyMs: probeResult.latencyMs ?? null } : null,
      observedAt: timestamp || new Date().toISOString(),
    });
  }
  return {
    correlatedEvents: events.sort((a, b) => (a.severity === b.severity ? b.occurrences - a.occurrences : (a.severity === "critical" ? -1 : 1))),
    suspectedPatterns: events.map((e) => e.patternId),
  };
}

export function listKnownPatterns() {
  return PATTERNS.map(({ id, layer, severity, title }) => ({ id, layer, severity, title }));
}