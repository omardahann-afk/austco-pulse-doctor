/**
 * Webmin Probe (Phase 7D)
 * ------------------------
 * Validates a Webmin instance by GETting `/session_login.cgi` over HTTPS and
 * looking for Webmin-specific markers in the response body. Used for IPC
 * Primary/Secondary and any Linux host running Webmin admin UI.
 *
 * Default port: 10000. TLS: true. Self-signed accepted.
 * Never throws. Always returns an evidence record.
 */
import https from "node:https";
import http from "node:http";
import { makeEvidence } from "./evidence.js";

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;
const MARKERS = ["Webmin", "session_login", "webmin_search"];

export async function webminProbe(device, opts = {}) {
  const startedAt = Date.now();
  const host = String(device?.host || "").trim();
  const port = Number(device?.port || 10000);
  const tls = device?.tls === false ? false : true; // default true for Webmin
  const timeoutMs = Number(opts.timeoutMs) || 5000;
  const path = "/session_login.cgi";

  if (!host || !HOST_RE.test(host)) {
    return makeEvidence({ protocol: "webmin", device, ok: false, error: "invalid host", startedAt });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return makeEvidence({ protocol: "webmin", device, ok: false, error: "invalid port", startedAt });
  }

  const lib = tls ? https : http;
  const url = `${tls ? "https" : "http"}://${host}:${port}${path}`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (ev) => { if (done) return; done = true; resolve(ev); };

    const req = lib.request({
      host, port, path, method: "GET",
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { "User-Agent": "tacera-doctor-probe/1.0" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 8192) body += chunk; });
      res.on("end", () => {
        const latencyMs = Date.now() - startedAt;
        const status = res.statusCode || 0;
        const matchedMarker = MARKERS.find((m) => body.includes(m)) || null;
        const ok = status >= 200 && status < 500 && Boolean(matchedMarker);
        finish(makeEvidence({
          protocol: "webmin", device, ok, latencyMs,
          error: ok ? null : (matchedMarker ? `unexpected status ${status}` : `not_webmin: status ${status}, no marker`),
          startedAt,
          raw: { url, status, contentLength: body.length, matchedMarker, headers: { server: res.headers?.server || null } },
        }));
      });
    });

    req.on("timeout", () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on("error", (err) => {
      finish(makeEvidence({
        protocol: "webmin", device, ok: false,
        error: err?.code ? `${err.code}: ${err.message}` : (err?.message || String(err)),
        startedAt, raw: { url },
      }));
    });
    req.end();
  });
}