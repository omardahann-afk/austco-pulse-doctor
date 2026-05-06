/**
 * Real MQTT connection validation probe.
 *
 * This probe ONLY validates that an MQTT broker accepts CONNECT and replies
 * with a CONNACK. It does NOT subscribe or hold a session — that is the job
 * of the live event pipeline (next phase). This probe is fast (<5s) and
 * suitable for scheduled polling.
 *
 * Captures: connect latency, connack reason, broker hostname/port, tls flag.
 * Never throws.
 */
import mqtt from "mqtt";
import { makeEvidence } from "./evidence.js";

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;

export async function mqttConnectProbe(device, opts = {}) {
  const startedAt = Date.now();
  const host = String(device?.host || "").trim();
  const port = Number(device?.port || (device?.tls ? 8883 : 1883));
  const tls = Boolean(device?.tls);
  const timeoutMs = Number(opts.timeoutMs) || 5000;
  const username = device?.username || undefined;
  const password = device?.password || undefined;

  if (!host || !HOST_RE.test(host)) {
    return makeEvidence({ protocol: "mqtt", device, ok: false, error: "invalid host", startedAt });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return makeEvidence({ protocol: "mqtt", device, ok: false, error: "invalid port", startedAt });
  }

  const url = `${tls ? "mqtts" : "mqtt"}://${host}:${port}`;
  return new Promise((resolve) => {
    let done = false;
    let client;
    const finish = (ev) => {
      if (done) return; done = true;
      try { client?.end(true); } catch {}
      resolve(ev);
    };
    const t = setTimeout(() => finish(makeEvidence({
      protocol: "mqtt", device, ok: false, error: `timeout after ${timeoutMs}ms`, startedAt,
      raw: { url, tls, port, timeoutMs },
    })), timeoutMs);

    try {
      client = mqtt.connect(url, {
        username, password,
        reconnectPeriod: 0,
        connectTimeout: timeoutMs,
        rejectUnauthorized: false,
        clientId: `tacera-probe-${Math.random().toString(36).slice(2, 10)}`,
      });
    } catch (err) {
      clearTimeout(t);
      return finish(makeEvidence({ protocol: "mqtt", device, ok: false, error: err?.message || String(err), startedAt, raw: { url } }));
    }

    client.on("connect", (connack) => {
      clearTimeout(t);
      const latencyMs = Date.now() - startedAt;
      finish(makeEvidence({
        protocol: "mqtt", device, ok: true, latencyMs,
        raw: {
          url, tls, port,
          connack: {
            returnCode: connack?.returnCode ?? null,
            sessionPresent: connack?.sessionPresent ?? null,
            reasonCode: connack?.reasonCode ?? null,
          },
        },
        startedAt,
      }));
    });
    client.on("error", (err) => {
      clearTimeout(t);
      finish(makeEvidence({
        protocol: "mqtt", device, ok: false,
        error: err?.code ? `${err.code}: ${err.message}` : (err?.message || String(err)),
        startedAt,
        raw: { url, errno: err?.errno || null, code: err?.code || null },
      }));
    });
  });
}