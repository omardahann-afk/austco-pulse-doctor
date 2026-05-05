/**
 * Advanced log intelligence for Austco/Tacera systems.
 *
 * Extracts structured findings from raw log lines for the four log source
 * categories: Integration Gateway, Pulse Gateway, IPConnect/xcare, and any
 * service producing license/TLS errors.
 *
 * Output finding shape:
 *   {
 *     type,          // ACTIVATE_TIMEOUT | CANCEL_TIMEOUT | INVALID_CALLPOINT |
 *                    // INVALID_SIGNAL | MQTT_DISCONNECT | WEBSOCKET_ERROR |
 *                    // LICENSE_ERROR | CERT_ERROR | TLS_ERROR | EVENT_QUEUE |
 *                    // CONNECTION_REFUSED | DISCONNECT | TIMEOUT |
 *                    // CONFIG_MISMATCH | GENERIC_ERROR | WARNING
 *     layer,         // network | access | service | application | configuration | dependency
 *     severity,      // ERROR | WARN | INFO
 *     timestamp,     // ISO or syslog string or null
 *     cpId,          // INTG.* / TSNS:* / 4245.0.0.0 etc., or null
 *     invalidCpId,   // CP id called out in "Invalid call point ID …" lines
 *     eventType,     // ACTIVATE | CANCEL | null
 *     callType,      // "Maintenance Call" | "Nurse Call" | null
 *     fqLocation,    // freeform location string from log line
 *     signature,     // normalized message used for repetition counting
 *     message,       // short human message
 *     raw,           // full source line (truncated to 1000 chars)
 *     line,          // 1-based line index
 *   }
 */

const RX_TS_ISO = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
const RX_TS_SYSLOG = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/;

// Callpoint identifiers seen in real Austco logs:
//   INTG.1986320963          (Integration Gateway scoped)
//   TSNS:4C-452              (Tacera sensor)
//   4245.0.0.0               (legacy 4-octet CP id)
//   CP-1234 / CP1234         (controller-mapped)
const RX_CP_ID = /\b(?:INTG\.\d+|TSNS:[A-Z0-9-]+|CP-?\d+|\d{1,5}(?:\.\d{1,5}){3})\b/g;

// Capture the offending CP id from "Invalid call point ID or signal attributes for <ID>"
// and similar phrasings. We deliberately skip filler words (or, and, for, the, a)
// so the captured token is the actual identifier.
const RX_INVALID_CP = /invalid (?:call ?point|signal|cp)[\s\S]*?\b(?:for|=|:)\s*([A-Za-z]+(?:\.\d+)+|INTG\.\d+|TSNS:[A-Z0-9-]+|CP-?\d+|\d{1,5}(?:\.\d{1,5}){3})\b/i;
const RX_FQ_LOCATION = /\bfqLocation\s*[:=]\s*"?([^"\n]+?)"?(?:\s*[,;}]|$)/i;
const RX_CALL_TYPE = /\b(Maintenance Call|Nurse Call|Emergency Call|Code Blue|Cancel Call|Staff Call)\b/i;

const MAX_FINDINGS = 400;

function extractTimestamp(line) {
  const iso = line.match(RX_TS_ISO);
  if (iso) return iso[1];
  const sys = line.match(RX_TS_SYSLOG);
  if (sys) return sys[1];
  return null;
}

function extractCpIds(line) {
  const ids = line.match(RX_CP_ID) || [];
  return Array.from(new Set(ids));
}

/**
 * Classify a single log line into structured finding metadata.
 * Returns null when the line carries no diagnostically useful signal.
 */
function classify(line) {
  const lower = line.toLowerCase();
  const upper = line.toUpperCase();
  const isError = /\bERROR\b|\bERR\b|\bFATAL\b|\bSEVERE\b|\bCRITICAL\b/.test(upper);
  const isWarn = /\bWARN(?:ING)?\b/.test(upper);

  // Application-layer ACTIVATE/CANCEL timeouts (rules D, F, H)
  if (/activate.*(failed.*timeout|timed out|timeout)/i.test(line) || /\bACTIVATE_TIMEOUT\b/.test(line)) {
    return { type: "ACTIVATE_TIMEOUT", layer: "application", severity: "ERROR", eventType: "ACTIVATE" };
  }
  if (/cancel.*(failed.*timeout|timed out|timeout)/i.test(line) || /\bCANCEL_TIMEOUT\b/.test(line)) {
    return { type: "CANCEL_TIMEOUT", layer: "application", severity: "ERROR", eventType: "CANCEL" };
  }

  // Configuration-layer: invalid CP ids / signal attributes (rules E, G)
  if (/invalid (?:call ?point|signal)/i.test(line)) {
    if (/signal attributes?/i.test(line)) {
      return { type: "INVALID_SIGNAL", layer: "configuration", severity: "ERROR" };
    }
    return { type: "INVALID_CALLPOINT", layer: "configuration", severity: "ERROR" };
  }

  // License / TLS / cert (rules J, K)
  if (/\blicense\b/i.test(line) && /(expired|invalid|fail|unauthori[sz]ed|not valid)/i.test(line)) {
    return { type: "LICENSE_ERROR", layer: "configuration", severity: "ERROR" };
  }
  if (/\b(certificate|x509|ca chain)\b/i.test(line) && /(expired|invalid|untrusted|unable to verify|self.?signed|chain)/i.test(line)) {
    return { type: "CERT_ERROR", layer: "configuration", severity: "ERROR" };
  }
  if (/\b(tls|ssl)\b.*(handshake|alert|protocol|fatal|fail)/i.test(line)) {
    return { type: "TLS_ERROR", layer: "configuration", severity: "ERROR" };
  }

  // Messaging / dependency layer (rule I)
  if (/\bmqtt\b/i.test(lower) && /(disconnect|connection lost|broker unavailable|refused)/i.test(lower)) {
    return { type: "MQTT_DISCONNECT", layer: "dependency", severity: "ERROR" };
  }
  if (/websocket/i.test(lower) && /(error|closed|disconnect|unexpected)/i.test(lower)) {
    return { type: "WEBSOCKET_ERROR", layer: "dependency", severity: "ERROR" };
  }
  if (/event queue.*(stop|halt|drained|stalled)/i.test(line)) {
    return { type: "EVENT_QUEUE", layer: "application", severity: "ERROR" };
  }

  // Service layer
  if (/\bconnection refused\b/i.test(line)) {
    return { type: "CONNECTION_REFUSED", layer: "service", severity: "ERROR" };
  }
  if (/\b(timeout|timed out)\b/i.test(line) && !/keep.?alive/i.test(line)) {
    return { type: "TIMEOUT", layer: "service", severity: isError ? "ERROR" : "WARN" };
  }
  if (/\bdisconnect/i.test(line)) {
    return { type: "DISCONNECT", layer: "service", severity: isError ? "ERROR" : "WARN" };
  }

  if (isError) return { type: "GENERIC_ERROR", layer: "service", severity: "ERROR" };
  if (isWarn) return { type: "WARNING", layer: "service", severity: "WARN" };
  return null;
}

function shortMessage(line) {
  let m = line.replace(RX_TS_ISO, "").replace(RX_TS_SYSLOG, "");
  m = m.replace(/^\s*[-:|]\s*/, "").trim();
  if (m.length > 240) m = m.slice(0, 237) + "...";
  return m;
}

/** Normalize a line to a signature for repetition counting. */
function signatureOf(line) {
  return line
    .replace(RX_TS_ISO, "")
    .replace(RX_TS_SYSLOG, "")
    .replace(RX_CP_ID, "<CP>")
    .replace(/\b\d{1,5}(?:\.\d{1,5}){3}\b/g, "<CP4>")
    .replace(/\b\d+\b/g, "<N>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Parse a single log file into structured findings.
 * Drop-in replacement for legacy parseLogFile — exposes the same surface
 * (totalLines/errors/warnings/findings) PLUS richer per-finding metadata.
 */
export function parseLogIntelligence(serviceName, fileContent) {
  const content = String(fileContent || "");
  const lines = content.split(/\r?\n/);
  let errors = 0;
  let warnings = 0;
  const errorFindings = [];
  const warnFindings = [];
  const otherFindings = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const cls = classify(raw);
    if (!cls) continue;

    if (cls.severity === "ERROR") errors++;
    else if (cls.severity === "WARN") warnings++;

    const cpIds = extractCpIds(raw);
    let invalidCpId = null;
    const invMatch = raw.match(RX_INVALID_CP);
    if (invMatch) invalidCpId = invMatch[1];

    const fqMatch = raw.match(RX_FQ_LOCATION);
    const fqLocation = fqMatch ? fqMatch[1].trim() : null;

    const callMatch = raw.match(RX_CALL_TYPE);
    const callType = callMatch ? callMatch[1] : null;

    const finding = {
      type: cls.type,
      layer: cls.layer,
      severity: cls.severity,
      timestamp: extractTimestamp(raw),
      cpId: cpIds[0] || null,
      cpIds,
      invalidCpId,
      eventType: cls.eventType || null,
      callType,
      fqLocation,
      signature: signatureOf(raw),
      message: shortMessage(raw),
      raw: raw.length > 1000 ? raw.slice(0, 1000) + "..." : raw,
      line: i + 1,
      service: serviceName,
    };

    if (cls.severity === "ERROR") errorFindings.push(finding);
    else if (cls.severity === "WARN") warnFindings.push(finding);
    else otherFindings.push(finding);
  }

  const findings = [...errorFindings, ...warnFindings, ...otherFindings].slice(0, MAX_FINDINGS);

  return {
    service: serviceName,
    totalLines: lines.length,
    errors,
    warnings,
    findings,
  };
}
