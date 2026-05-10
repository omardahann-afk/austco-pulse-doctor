/**
 * Real HTTPS health probe.
 *
 * Performs a GET (or configurable method) against an absolute URL and
 * captures status, response time, content-type, body snippet, and TLS
 * peer cert info (subject, issuer, validTo).
 *
 * Never throws — failure becomes ok=false with error string.
 */
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import { makeEvidence } from "./evidence.js";

const MAX_BODY = 4096;

function isAllowedUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    // hostname character class consistent with safeHost
    if (!/^[A-Za-z0-9._:-]{1,253}$/.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function httpsProbe(device, opts = {}) {
  const startedAt = Date.now();
  const url = String(device?.url || opts.url || "").trim();
  const method = String(opts.method || "GET").toUpperCase();
  const timeoutMs = Number(opts.timeoutMs) || 6000;
  const expectedStatus = Array.isArray(opts.expectedStatus) ? opts.expectedStatus : [200, 204, 301, 302];
  const insecure = opts.insecure === true; // accept self-signed (Austco appliances often use them)

  if (!url) {
    return makeEvidence({ protocol: "https", device, ok: false, error: "no url configured", startedAt });
  }
  if (!isAllowedUrl(url)) {
    return makeEvidence({ protocol: "https", device, ok: false, error: "invalid_url", startedAt });
  }

  const parsed = new URL(url);
  const lib = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let done = false;
    const finish = (ev) => { if (done) return; done = true; resolve(ev); };
    const t = setTimeout(() => finish(makeEvidence({
      protocol: parsed.protocol === "https:" ? "https" : "http",
      device,
      ok: false,
      error: `timeout after ${timeoutMs}ms`,
      startedAt,
      raw: { url, method, timeoutMs },
    })), timeoutMs);

    const req = lib.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      rejectUnauthorized: !insecure,
      timeout: timeoutMs,
      headers: { "user-agent": "tacera-doctor/1.0" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < MAX_BODY) body += chunk;
      });
      res.on("end", () => {
        clearTimeout(t);
        let cert = null;
        try {
          if (parsed.protocol === "https:" && req.socket?.getPeerCertificate) {
            const c = req.socket.getPeerCertificate();
            if (c && Object.keys(c).length) {
              cert = {
                subject: c.subject?.CN || null,
                issuer: c.issuer?.CN || null,
                validFrom: c.valid_from || null,
                validTo: c.valid_to || null,
              };
            }
          }
        } catch { /* ignore */ }
        const status = res.statusCode || 0;
        const ok = expectedStatus.includes(status);
        finish(makeEvidence({
          protocol: parsed.protocol === "https:" ? "https" : "http",
          device,
          ok,
          latencyMs: Date.now() - startedAt,
          raw: {
            url, method, status,
            statusText: res.statusMessage || "",
            headers: { "content-type": res.headers["content-type"] || null, server: res.headers.server || null },
            bodySnippet: body.slice(0, MAX_BODY),
            cert,
          },
          error: ok ? null : `unexpected_status_${status}`,
          startedAt,
        }));
      });
    });
    req.on("error", (err) => {
      clearTimeout(t);
      finish(makeEvidence({
        protocol: parsed.protocol === "https:" ? "https" : "http",
        device,
        ok: false,
        error: err?.code ? `${err.code}: ${err.message}` : (err?.message || String(err)),
        startedAt,
        raw: { url, method, errno: err?.errno, code: err?.code || null },
      }));
    });
    req.on("timeout", () => { try { req.destroy(new Error("socket timeout")); } catch {} });
    req.end();
  });
}