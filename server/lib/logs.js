/**
 * Pattern-based log parser. Format-agnostic — extracts IPs, timestamps,
 * errors/warnings, controller/callpoint IDs, and common Austco-ish events.
 */

const RX_IP = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const RX_HOST = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi;
const RX_TS_ISO = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const RX_TS_SYSLOG = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/g;

const LEVEL_RX = {
  error: /\b(?:ERROR|ERR|FATAL|CRITICAL|EXCEPTION|FAILED|FAILURE|TIMEOUT)\b/i,
  warn:  /\b(?:WARN|WARNING)\b/i,
};

const EVENT_RX = [
  { tag: "disconnect", rx: /\b(disconnect(?:ed)?|connection (?:lost|closed|reset)|link down|peer down)\b/i },
  { tag: "offline",    rx: /\boffline\b/i },
  { tag: "heartbeat_fail", rx: /\bheart[- ]?beat[^.\n]{0,40}(?:lost|missed|fail|timeout)\b/i },
  { tag: "license_error",  rx: /\blicense[^.\n]{0,40}(?:invalid|expired|error|fail)\b/i },
  { tag: "auth_fail",      rx: /\b(?:auth(?:entication)? (?:failed|failure)|access denied|unauthorized)\b/i },
  { tag: "active_event",   rx: /\b(?:input|call(?:point)?)[^.\n]{0,40}\bactive\b/i },
  { tag: "cancel_event",   rx: /\bcancel(?:l?ed)?\b/i },
  { tag: "output_fired",   rx: /\boutput[^.\n]{0,40}(?:activated|fired|on|set)\b/i },
];

const ID_RX = [
  { kind: "controller_id", rx: /\bcontroller[\s_-]?(?:id\s*[:=]\s*)?([A-Za-z0-9_-]{1,16})\b/gi },
  { kind: "callpoint_id",  rx: /\b(?:call[\s_-]?point|cp)[\s_-]?(?:id\s*[:=]\s*)?([A-Za-z0-9_-]{1,16})\b/gi },
];

function detectFileType(name = "", content = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".ccp") || n.endsWith(".xml")) return "ccp_or_xml";
  if (/pulse/.test(n)) return "pulse_log";
  if (/ipconnect/.test(n)) return "ipconnect_log";
  if (/inga|integration/.test(n)) return "inga_log";
  if (/license/.test(n)) return "license_log";
  if (/controller/.test(n)) return "controller_log";
  if (/callpoint|inputs|outputs|events/.test(n)) return "event_log";
  // content sniffs
  if (/^\s*[{[]/.test(content)) return "json";
  return "generic_log";
}

function uniq(arr, max = 200) {
  const seen = new Set(); const out = [];
  for (const v of arr) { if (!seen.has(v)) { seen.add(v); out.push(v); if (out.length >= max) break; } }
  return out;
}

function analyzeFile(file) {
  const content = String(file.content || "");
  const name = String(file.name || "unnamed");
  const userType = file.type && file.type !== "auto" ? file.type : null;
  const detectedType = userType || detectFileType(name, content);

  const lines = content.split(/\r?\n/);

  const ips = uniq(content.match(RX_IP) || []);
  const hosts = uniq((content.match(RX_HOST) || []).filter((h) => /\D/.test(h.replace(/\./g, ""))));
  const timestamps = uniq([...(content.match(RX_TS_ISO) || []), ...(content.match(RX_TS_SYSLOG) || [])]);

  const errors = [];
  const warnings = [];
  const events = [];
  const controllerIds = new Set();
  const callpointIds = new Set();

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const trimmed = line.length > 500 ? line.slice(0, 500) + "…" : line;
    if (LEVEL_RX.error.test(line)) errors.push({ line: i + 1, text: trimmed });
    else if (LEVEL_RX.warn.test(line)) warnings.push({ line: i + 1, text: trimmed });
    for (const ev of EVENT_RX) {
      if (ev.rx.test(line)) events.push({ line: i + 1, tag: ev.tag, text: trimmed });
    }
    for (const def of ID_RX) {
      let m; def.rx.lastIndex = 0;
      while ((m = def.rx.exec(line))) {
        if (def.kind === "controller_id") controllerIds.add(m[1]);
        else callpointIds.add(m[1]);
      }
    }
  });

  // Tag heuristic counts
  const eventCounts = events.reduce((acc, e) => { acc[e.tag] = (acc[e.tag] || 0) + 1; return acc; }, {});

  return {
    file: name,
    detectedType,
    userType,
    sizeBytes: content.length,
    lineCount: lines.length,
    ips,
    hosts: hosts.slice(0, 50),
    timestamps: timestamps.slice(0, 20),
    errors: errors.slice(0, 100),
    warnings: warnings.slice(0, 100),
    events: events.slice(0, 200),
    eventCounts,
    controllerIds: [...controllerIds].slice(0, 50),
    callpointIds: [...callpointIds].slice(0, 50),
  };
}

export function analyzeLogs(files, vm) {
  const startedAt = new Date().toISOString();
  const fileResults = files.map(analyzeFile);
  const finishedAt = new Date().toISOString();

  // Aggregate evidence
  const evidence = [];
  let totalErrors = 0, totalWarnings = 0;
  const aggCounts = {};
  for (const f of fileResults) {
    totalErrors += f.errors.length;
    totalWarnings += f.warnings.length;
    for (const [k, v] of Object.entries(f.eventCounts)) aggCounts[k] = (aggCounts[k] || 0) + v;
    if (f.errors.length) evidence.push(`${f.file}: ${f.errors.length} error line${f.errors.length === 1 ? "" : "s"}`);
    if (f.warnings.length) evidence.push(`${f.file}: ${f.warnings.length} warning line${f.warnings.length === 1 ? "" : "s"}`);
    for (const [tag, n] of Object.entries(f.eventCounts)) evidence.push(`${f.file}: ${n}× ${tag}`);
  }

  // Verdict
  let summary;
  if (aggCounts.license_error) summary = `License errors found in uploaded logs (${aggCounts.license_error}).`;
  else if (aggCounts.heartbeat_fail) summary = `Heartbeat failures present in logs (${aggCounts.heartbeat_fail}).`;
  else if (aggCounts.disconnect && aggCounts.disconnect >= 3) summary = `Repeated disconnects observed (${aggCounts.disconnect}).`;
  else if (totalErrors > 0) summary = `${totalErrors} error line${totalErrors === 1 ? "" : "s"} across uploaded logs.`;
  else if (totalWarnings > 0) summary = `${totalWarnings} warning line${totalWarnings === 1 ? "" : "s"} — no errors detected.`;
  else summary = "No errors, warnings, or notable events detected in uploaded logs.";

  return {
    ok: true,
    mode: "LOG ANALYSIS",
    vm,
    startedAt,
    finishedAt,
    summary,
    confidence: totalErrors > 0 || Object.keys(aggCounts).length > 0 ? "MEDIUM" : "LOW",
    evidence: evidence.slice(0, 60),
    files: fileResults,
    aggregate: {
      totalErrors,
      totalWarnings,
      eventCounts: aggCounts,
      uniqueIps: uniq(fileResults.flatMap((f) => f.ips)),
      uniqueHosts: uniq(fileResults.flatMap((f) => f.hosts)),
      uniqueControllerIds: uniq(fileResults.flatMap((f) => f.controllerIds)),
      uniqueCallpointIds: uniq(fileResults.flatMap((f) => f.callpointIds)),
    },
  };
}
