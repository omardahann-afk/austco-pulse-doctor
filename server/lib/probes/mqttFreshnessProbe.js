/**
 * MQTT Freshness Probe (Phase 7D)
 * --------------------------------
 * Subscribes to one or more topics for a bounded window and records the
 * age of the most recent message received. Distinct from `mqttConnectProbe`,
 * which only validates that the broker accepts CONNECT.
 *
 * Inputs (on `device.meta`):
 *   mqttTopics:        string[]   — topics to subscribe to (default ["#"])
 *   freshnessWindowMs: number     — listen window per probe (default 6000)
 *   staleThresholdMs:  number     — max acceptable message age (default 60000)
 *
 * Outputs:
 *   ok            — true if a message arrived within staleThresholdMs
 *   latencyMs     — time since the most recent message (== "freshness age")
 *   raw.lastTopic — topic of the most recent message
 *   raw.received  — count of messages observed during the window
 *   error         — set when no message ever arrived ("stale" or "no_messages")
 *
 * Never throws. Always returns a real evidence record.
 */
import mqtt from "mqtt";
import { makeEvidence } from "./evidence.js";

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;

export async function mqttFreshnessProbe(device, opts = {}) {
  const startedAt = Date.now();
  const host = String(device?.host || "").trim();
  const tls = Boolean(device?.tls);
  const port = Number(device?.port || (tls ? 8883 : 1883));

  const meta = device?.meta || {};
  const topics = Array.isArray(meta.mqttTopics) && meta.mqttTopics.length
    ? meta.mqttTopics.slice(0, 16) : ["#"];
  const windowMs = Number(opts.windowMs ?? meta.freshnessWindowMs ?? 6_000);
  const staleThresholdMs = Number(opts.staleThresholdMs ?? meta.staleThresholdMs ?? 60_000);
  const username = device?.username || meta.username || undefined;
  const password = device?.password || meta.password || undefined;

  if (!host || !HOST_RE.test(host)) {
    return makeEvidence({ protocol: "mqtt-fresh", device, ok: false, error: "invalid host", startedAt });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return makeEvidence({ protocol: "mqtt-fresh", device, ok: false, error: "invalid port", startedAt });
  }

  const url = `${tls ? "mqtts" : "mqtt"}://${host}:${port}`;

  return new Promise((resolve) => {
    let done = false;
    let client;
    let lastMessageAt = null;
    let lastTopic = null;
    let received = 0;
    let connected = false;
    let connectError = null;

    const finish = () => {
      if (done) return; done = true;
      try { client?.end(true); } catch {}
      const ageMs = lastMessageAt == null ? null : Date.now() - lastMessageAt;
      const ok = lastMessageAt != null && ageMs != null && ageMs <= staleThresholdMs;
      let error = null;
      if (!connected) error = connectError || "connect failed";
      else if (lastMessageAt == null) error = `no_messages: no traffic on ${topics.join(",")} within ${windowMs}ms`;
      else if (!ok) error = `stale: last message ${ageMs}ms ago (>${staleThresholdMs}ms)`;
      resolve(makeEvidence({
        protocol: "mqtt-fresh", device, ok, latencyMs: ageMs, error, startedAt,
        raw: { url, tls, port, topics, windowMs, staleThresholdMs, received, lastTopic, lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null, connected },
      }));
    };

    const closeTimer = setTimeout(finish, windowMs + 1500);

    try {
      client = mqtt.connect(url, {
        username, password,
        reconnectPeriod: 0,
        connectTimeout: Math.min(windowMs, 5000),
        rejectUnauthorized: false,
        clientId: `tacera-fresh-${Math.random().toString(36).slice(2, 10)}`,
      });
    } catch (err) {
      connectError = err?.message || String(err);
      clearTimeout(closeTimer);
      return finish();
    }

    client.on("connect", () => {
      connected = true;
      client.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          connectError = err?.message || "subscribe failed";
          clearTimeout(closeTimer);
          finish();
          return;
        }
        // Stop listening after the window.
        setTimeout(finish, windowMs);
      });
    });

    client.on("message", (topic) => {
      lastMessageAt = Date.now();
      lastTopic = topic;
      received += 1;
    });

    client.on("error", (err) => {
      connectError = err?.code ? `${err.code}: ${err.message}` : (err?.message || String(err));
      clearTimeout(closeTimer);
      finish();
    });
  });
}