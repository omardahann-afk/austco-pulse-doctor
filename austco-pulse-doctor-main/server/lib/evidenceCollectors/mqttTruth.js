/**
 * MQTT Truth — optional live tap.
 *
 * Subscribes to a wildcard topic for a bounded duration, captures event
 * timestamps and short payload summaries, and detects basic event-level
 * pathologies (silence, duplicate floods, stale loops, missing ACKs).
 *
 * No fake data. If broker creds are missing, callers receive a clear
 * "unavailable" status.
 */
import mqtt from "mqtt";

const sessions = new Map(); // sessionId -> { client, events, startedAt, expiresAt, params, stoppedReason }
const MAX_EVENTS = 2_000;
const MAX_PAYLOAD_SUMMARY = 240;
const HARD_MAX_DURATION_MS = 10 * 60_000;

function uid() { return `tap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

function summarizePayload(buf) {
  if (!buf) return "";
  let s;
  try { s = buf.toString("utf8"); } catch { return `<${buf.length} bytes>`; }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > MAX_PAYLOAD_SUMMARY ? s.slice(0, MAX_PAYLOAD_SUMMARY) + "…" : s;
}

function extractCorrelations(payloadStr) {
  const out = {};
  if (!payloadStr) return out;
  const cp = payloadStr.match(/\b(?:cp(?:_?id)?|callpoint(?:_?id)?)\s*[:=]\s*"?([A-Za-z0-9._:-]{2,40})/i);
  if (cp) out.cpId = cp[1];
  const room = payloadStr.match(/\broom(?:_?id)?\s*[:=]\s*"?([A-Za-z0-9._:-]{1,40})/i);
  if (room) out.room = room[1];
  const fq = payloadStr.match(/\bfq(?:_?location)?\s*[:=]\s*"?([^"]{1,80})/i);
  if (fq) out.fqLocation = fq[1].trim();
  const ct = payloadStr.match(/\b(?:call_?type|callType)\s*[:=]\s*"?([A-Za-z0-9 _:-]{1,40})/i);
  if (ct) out.callType = ct[1].trim();
  const evId = payloadStr.match(/\bevent_?id\s*[:=]\s*"?([A-Za-z0-9._:-]{4,40})/i);
  if (evId) out.eventId = evId[1];
  return out;
}

/**
 * Begin a live MQTT tap. Returns { ok, sessionId, expiresAt } or { ok:false, reason, message }.
 * params: { brokerHost, brokerPort, username, password, tls, topic, durationSeconds, ackTopic? }
 */
export async function startMqttTap(params = {}) {
  const brokerHost = String(params.brokerHost || "").trim();
  const brokerPort = Number(params.brokerPort || (params.tls ? 8883 : 1883));
  const topic = String(params.topic || "").trim();
  const durationSeconds = Math.min(Math.max(Number(params.durationSeconds) || 30, 5), HARD_MAX_DURATION_MS / 1000);

  if (!brokerHost) return { ok: false, reason: "no_broker", message: "MQTT tap unavailable — credentials not configured." };
  if (!topic) return { ok: false, reason: "no_topic", message: "MQTT tap requires a topic wildcard." };

  const url = `${params.tls ? "mqtts" : "mqtt"}://${brokerHost}:${brokerPort}`;
  let client;
  try {
    client = mqtt.connect(url, {
      username: params.username || undefined,
      password: params.password || undefined,
      reconnectPeriod: 0,
      connectTimeout: 6_000,
      rejectUnauthorized: false,
    });
  } catch (err) {
    return { ok: false, reason: "mqtt_connect_failed", message: err?.message || String(err) };
  }

  const sessionId = uid();
  const startedAt = Date.now();
  const expiresAt = startedAt + durationSeconds * 1000;
  const session = {
    client,
    events: [],
    startedAt: new Date(startedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    params: { brokerHost, brokerPort, tls: !!params.tls, topic, ackTopic: params.ackTopic || null, durationSeconds },
    stoppedReason: null,
    connected: false,
    error: null,
  };
  sessions.set(sessionId, session);

  return await new Promise((resolve) => {
    let resolved = false;
    const fail = (reason, message) => {
      if (resolved) return; resolved = true;
      session.stoppedReason = reason; session.error = message;
      try { client.end(true); } catch {}
      resolve({ ok: false, reason, message });
    };
    const ok = () => {
      if (resolved) return; resolved = true;
      session.connected = true;
      resolve({ ok: true, sessionId, expiresAt: session.expiresAt, startedAt: session.startedAt });
    };
    const connectTimer = setTimeout(() => fail("mqtt_timeout", "MQTT broker did not connect in time."), 6_500);
    client.on("connect", () => {
      clearTimeout(connectTimer);
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) return fail("mqtt_subscribe_failed", err.message);
        ok();
        // Schedule auto-stop
        const stopTimer = setTimeout(() => {
          session.stoppedReason = "duration_elapsed";
          try { client.end(true); } catch {}
        }, durationSeconds * 1000);
        session.stopTimer = stopTimer;
      });
    });
    client.on("message", (t, payload) => {
      if (session.events.length >= MAX_EVENTS) return;
      const summary = summarizePayload(payload);
      session.events.push({
        ts: new Date().toISOString(),
        topic: t,
        bytes: payload?.length || 0,
        payloadSummary: summary,
        correlations: extractCorrelations(summary),
      });
    });
    client.on("error", (err) => fail("mqtt_error", err?.message || String(err)));
    client.on("close", () => { /* end of session */ });
  });
}

export function stopMqttTap(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, reason: "session_not_found" };
  try { s.client.end(true); } catch {}
  if (s.stopTimer) clearTimeout(s.stopTimer);
  s.stoppedReason = s.stoppedReason || "stopped_by_user";
  return { ok: true, sessionId, stoppedReason: s.stoppedReason, eventCount: s.events.length };
}

export function getMqttSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return {
    sessionId,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    connected: s.connected,
    stoppedReason: s.stoppedReason,
    error: s.error,
    params: s.params,
    eventCount: s.events.length,
    events: s.events,
  };
}

export function listMqttSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    sessionId: id, startedAt: s.startedAt, expiresAt: s.expiresAt,
    connected: s.connected, stoppedReason: s.stoppedReason,
    eventCount: s.events.length, params: s.params,
  }));
}

/**
 * Analyze events captured by a session. Returns derived signals used by the
 * deepEvidenceEngine (silence, duplicate floods, missing ACKs).
 */
export function analyzeMqttEvents(session) {
  if (!session) return { available: false, reason: "no_session" };
  const events = session.events || [];
  const observedCpIds = new Set();
  const observedRooms = new Set();
  const topicCounts = {};
  const eventIdCounts = {};
  for (const e of events) {
    topicCounts[e.topic] = (topicCounts[e.topic] || 0) + 1;
    if (e.correlations?.cpId) observedCpIds.add(e.correlations.cpId);
    if (e.correlations?.room) observedRooms.add(e.correlations.room);
    if (e.correlations?.eventId) {
      eventIdCounts[e.correlations.eventId] = (eventIdCounts[e.correlations.eventId] || 0) + 1;
    }
  }
  const duplicates = Object.entries(eventIdCounts).filter(([, n]) => n > 3).map(([id, n]) => ({ eventId: id, count: n }));

  // Missing ACK detection — only meaningful when an ackTopic was configured.
  const ackTopic = session.params?.ackTopic;
  let missingAcks = [];
  if (ackTopic) {
    const acks = new Set(events.filter((e) => e.topic === ackTopic).map((e) => e.correlations?.eventId).filter(Boolean));
    missingAcks = Object.keys(eventIdCounts).filter((id) => !acks.has(id)).slice(0, 10);
  }

  const silence = events.length === 0;

  return {
    available: true,
    sessionId: session.sessionId,
    eventCount: events.length,
    topicCounts,
    duplicates,
    missingAcks,
    silence,
    observedCpIds: Array.from(observedCpIds),
    observedRooms: Array.from(observedRooms),
    ackTopic: ackTopic || null,
  };
}