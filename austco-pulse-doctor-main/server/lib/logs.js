/**
 * Deterministic line-by-line log parser.
 *
 * parseLogFile(serviceName, fileContent) returns:
 *   { service, totalLines, errors, warnings, findings: [{ type, message, timestamp, raw }] }
 *
 * Detection rules (case-insensitive, evaluated per line in priority order):
 *   LICENSE_ERROR       — "license" AND ("expired" OR "invalid")
 *   AUTH_FAILURE        — "auth failed" OR "authentication failed"
 *   CONNECTION_REFUSED  — "connection refused"
 *   TIMEOUT             — "timeout" OR "timed out"
 *   CERTIFICATE_ERROR   — "certificate" OR "TLS" OR "SSL"
 *   DISCONNECT          — "disconnect"
 *   RECONNECT           — "reconnect"
 *   MQTT_EVENT          — "mqtt"
 *   WEBSOCKET_EVENT     — "websocket"
 *   GENERIC_ERROR       — "error" (fallback)
 *
 * Severity:
 *   contains "ERROR" => errors++
 *   contains "WARN"  => warnings++
 *
 * Output capped at 200 findings per file, ERRORs prioritized over WARNs.
 */

const RX_TS_ISO = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
const RX_TS_SYSLOG = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/;
const RX_IP = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const RX_HOST = /\b[a-zA-Z0-9][a-zA-Z0-9-]{0,62}(?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,62})+\b/g;

const MAX_FINDINGS = 200;

function extractTimestamp(line) {
  const iso = line.match(RX_TS_ISO);
  if (iso) return iso[1];
  const sys = line.match(RX_TS_SYSLOG);
  if (sys) return sys[1];
  return null;
}

function detectType(line) {
  const l = line.toLowerCase();
  if (/\blicense\b/.test(l) && /(expired|invalid)/.test(l)) return "LICENSE_ERROR";
  if (/\b(auth(?:entication)? failed)\b/.test(l)) return "AUTH_FAILURE";
  if (/\bconnection refused\b/.test(l)) return "CONNECTION_REFUSED";
  if (/\b(timeout|timed out)\b/.test(l)) return "TIMEOUT";
  if (/\b(certificate|tls|ssl)\b/.test(l)) return "CERTIFICATE_ERROR";
  if (/\bdisconnect/.test(l)) return "DISCONNECT";
  if (/\breconnect/.test(l)) return "RECONNECT";
  if (/\bmqtt\b/.test(l)) return "MQTT_EVENT";
  if (/\bwebsocket\b/.test(l)) return "WEBSOCKET_EVENT";
  if (/\berror\b/.test(l)) return "GENERIC_ERROR";
  return null;
}

function shortMessage(line) {
  // Strip leading timestamp + level for a compact message; keep IPs/hosts in tail.
  let m = line.replace(RX_TS_ISO, "").replace(RX_TS_SYSLOG, "");
  m = m.replace(/^\s*[-:|]\s*/, "").trim();
  if (m.length > 240) m = m.slice(0, 237) + "...";
  return m;
}

export function parseLogFile(serviceName, fileContent) {
  const content = String(fileContent || "");
  const lines = content.split(/\r?\n/);
  let errors = 0, warnings = 0;
  const errorFindings = [];
  const warnFindings = [];
  const otherFindings = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const upper = raw.toUpperCase();
    const isError = /\bERROR\b|\bERR\b|\bFATAL\b|\bCRITICAL\b/.test(upper);
    const isWarn  = /\bWARN(?:ING)?\b/.test(upper);
    if (isError) errors++;
    if (isWarn) warnings++;

    const type = detectType(raw);
    if (!type && !isError && !isWarn) continue;

    const ips = raw.match(RX_IP) || [];
    const hosts = (raw.match(RX_HOST) || []).filter((h) => !/^\d/.test(h));
    let message = shortMessage(raw);
    if (ips.length) message += ` [ip:${ips.slice(0, 3).join(",")}]`;
    if (hosts.length) message += ` [host:${hosts.slice(0, 2).join(",")}]`;

    const finding = {
      type: type || (isError ? "GENERIC_ERROR" : "WARNING"),
      message,
      timestamp: extractTimestamp(raw),
      raw: raw.length > 1000 ? raw.slice(0, 1000) + "..." : raw,
      line: i + 1,
      severity: isError ? "ERROR" : isWarn ? "WARN" : "INFO",
    };
    if (isError) errorFindings.push(finding);
    else if (isWarn) warnFindings.push(finding);
    else otherFindings.push(finding);
  }

  // Prioritize ERROR > WARN > other; cap at MAX_FINDINGS total.
  const findings = [...errorFindings, ...warnFindings, ...otherFindings].slice(0, MAX_FINDINGS);

  return {
    service: serviceName,
    totalLines: lines.length,
    errors,
    warnings,
    findings,
  };
}

/**
 * Back-compat wrapper used by the older /api/logs/analyze upload path
 * (manual file uploads). Returns the legacy aggregate shape so existing
 * callers keep working — but each file now also carries a `findings` array
 * from parseLogFile, alongside the old `errors`/`warnings`/`events` fields.
 */
export function analyzeLogs(files, vm) {
  const startedAt = new Date().toISOString();
  const fileResults = (files || []).map((f) => {
    const parsed = parseLogFile(f.name || "unnamed", f.content || "");
    return {
      file: parsed.service,
      detectedType: f.type || "auto",
      userType: f.type && f.type !== "auto" ? f.type : null,
      sizeBytes: String(f.content || "").length,
      lineCount: parsed.totalLines,
      ips: [], hosts: [], timestamps: [],
      // legacy fields kept so the old UI doesn't crash; populated from findings
      errors: parsed.findings.filter((x) => x.severity === "ERROR").map((x) => ({ line: x.line, text: x.raw })),
      warnings: parsed.findings.filter((x) => x.severity === "WARN").map((x) => ({ line: x.line, text: x.raw })),
      events: parsed.findings.map((x) => ({ line: x.line, tag: x.type, text: x.raw })),
      eventCounts: parsed.findings.reduce((acc, x) => { acc[x.type] = (acc[x.type] || 0) + 1; return acc; }, {}),
      controllerIds: [], callpointIds: [],
      // new structured findings:
      findings: parsed.findings,
      totalErrors: parsed.errors,
      totalWarnings: parsed.warnings,
    };
  });
  const totalErrors = fileResults.reduce((s, f) => s + f.totalErrors, 0);
  const totalWarnings = fileResults.reduce((s, f) => s + f.totalWarnings, 0);
  const aggCounts = {};
  for (const f of fileResults) for (const [k, v] of Object.entries(f.eventCounts)) aggCounts[k] = (aggCounts[k] || 0) + v;
  return {
    ok: true, mode: "LOG ANALYSIS", vm, startedAt, finishedAt: new Date().toISOString(),
    summary: `${totalErrors} error line(s), ${totalWarnings} warning line(s) across ${fileResults.length} file(s).`,
    confidence: totalErrors > 0 ? "MEDIUM" : "LOW",
    evidence: fileResults.map((f) => `${f.file}: ${f.totalErrors} errors, ${f.totalWarnings} warnings, ${f.findings.length} findings`),
    files: fileResults,
    aggregate: {
      totalErrors, totalWarnings, eventCounts: aggCounts,
      uniqueIps: [], uniqueHosts: [], uniqueControllerIds: [], uniqueCallpointIds: [],
    },
  };
}
