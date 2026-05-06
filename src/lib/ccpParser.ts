/**
 * IPConnect CCP Parser (best-effort, no-hallucination)
 * ----------------------------------------------------
 * The exact CCP wire format is not assumed. The parser scans the raw
 * text/XML/INI-ish CCP export for well-known Tacera/IPConnect terms and
 * extracts entities with a per-field confidence rating.
 *
 * Rules:
 * - If a token cannot be confidently extracted, it is marked `unknown`.
 * - Confidence is "high" only when the value comes from a clearly labelled
 *   key/value pair; "medium" when inferred from context; "low" when the
 *   match is loose.
 * - Never invent values. The caller is responsible for downgrading findings
 *   that depend on low-confidence rows.
 */

export type CcpConfidence = "high" | "medium" | "low" | "unknown";

export const PARSER_VERSION = "ccp-parser/2.0.0";

export type CcpController = {
  name: string;
  controllerId: string;
  ip: string;
  location: string;
  confidence: CcpConfidence;
};

export type CcpRoom = {
  name: string;
  path: string;
  assignedDevices: string[];
  confidence: CcpConfidence;
};

export type CcpDevice = {
  name: string;
  type: string;
  address: string;
  controllerId: string;
  room: string;
  callTypes: string[];
  confidence: CcpConfidence;
};

export type CcpZone = {
  name: string;
  type: string;
  controllerId: string;
  confidence: CcpConfidence;
};

export type CcpGroupSignal = {
  name: string;
  includedZones: string[];
  targetOutput: string;
  targetController: string;
  confidence: CcpConfidence;
};

export type CcpCallType = {
  name: string;
  priority: number | null;
  category: string;
  cancelGroup: string;
  protectGroup: string;
  disableGroup: string;
  confidence: CcpConfidence;
};

export type CcpOutputRule = {
  source: string;
  target: string;
  confidence: CcpConfidence;
};

export type CcpCancelRule = {
  source: string;
  cancels: string;
  confidence: CcpConfidence;
};

export type CcpParseStatus =
  | "not_provided"
  | "parsed"
  | "parsed_low_confidence"
  | "parse_failed"
  | "ccp_zip_detected"
  | "partial";

/* -------------------------------------------------------------- */
/* Structured warnings (V2)                                       */
/* -------------------------------------------------------------- */

export type CcpWarningCode =
  | "duplicate_controller_ip"
  | "duplicate_controller_id"
  | "invalid_ip"
  | "orphan_device"
  | "unknown_controller_reference"
  | "malformed_section"
  | "partial_parse"
  | "low_confidence_match"
  | "unsupported_object_type"
  | "missing_room_mapping"
  | "no_ccp_markers"
  | "no_section_markers"
  | "parser_exception";

export type CcpWarningSeverity = "INFO" | "WARNING" | "CRITICAL";

export type CcpWarning = {
  code: CcpWarningCode;
  severity: CcpWarningSeverity;
  title: string;
  explanation: string;
  affectedObject: string;   // e.g. "controller:C01" / "device:CP-12" / ""
  rawEvidence: string;      // short raw snippet (truncated)
  line?: number | null;
};

export type CcpParserMetrics = {
  linesRead: number;
  matchedSections: number;
  unknownSections: number;
  recoveredSections: number;
  malformedSections: number;
  parseDurationMs: number;
};

export type CcpParseResult = {
  status: CcpParseStatus;
  confidence: CcpConfidence;
  controllers: CcpController[];
  rooms: CcpRoom[];
  devices: CcpDevice[];
  zones: CcpZone[];
  groupSignals: CcpGroupSignal[];
  callTypes: CcpCallType[];
  outputRules: CcpOutputRule[];
  cancelRules: CcpCancelRule[];
  warnings: string[];
  rawSize: number;
  /** V2 enrichment — always present, may be empty when parse_failed. */
  structuredWarnings?: CcpWarning[];
  rawUnparsed?: string[];
  parserMetrics?: CcpParserMetrics;
  confidenceScore?: number; // 0-100
  parserVersion?: string;
  /** ZIP archive (real .ccp) data — populated only when status === "ccp_zip_detected". */
  archive?: CcpArchive;
  plugins?: CcpPlugin[];
  endpoints?: CcpEndpoint[];
  fileType?: "ccp" | "cnfg";
};

export type CcpArchiveFile = { path: string; size: number; type: string; parsed: boolean; error: string | null };
export type CcpArchive = { isZip: boolean; internalFileCount: number; xmlFileCount: number; files: CcpArchiveFile[] };
export type CcpPlugin = { id: string; className: string | null; create: boolean | null; sourceFile: string; attributes: Record<string, unknown>; actions: Record<string, unknown> };
export type CcpEndpoint = { host: string | null; ip: string | null; port: number | null; protocol: string | null; sourceFile: string; sourceAttribute: string };

export const EMPTY_PARSE: CcpParseResult = {
  status: "not_provided",
  confidence: "unknown",
  controllers: [], rooms: [], devices: [], zones: [],
  groupSignals: [], callTypes: [], outputRules: [], cancelRules: [],
  warnings: [], rawSize: 0,
  structuredWarnings: [], rawUnparsed: [],
  parserMetrics: { linesRead: 0, matchedSections: 0, unknownSections: 0, recoveredSections: 0, malformedSections: 0, parseDurationMs: 0 },
  confidenceScore: 0,
  parserVersion: PARSER_VERSION,
};

/* -------------------------------------------------------------- */
/* Helpers                                                        */
/* -------------------------------------------------------------- */

/** Match key=value, key:value or <key>value</key> patterns globally. */
function* findPairs(text: string, key: string): Generator<{ value: string; loose: boolean }> {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // <Key>value</Key>
  const xml = new RegExp(`<\\s*${k}\\s*>([^<]+?)<\\s*/\\s*${k}\\s*>`, "gi");
  // Key="value", Key='value', Key=value, Key: value
  const kv  = new RegExp(`\\b${k}\\s*[=:]\\s*"?([^"\\n,;<>]+?)"?(?=\\s|,|;|$|<)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = xml.exec(text))) yield { value: m[1].trim(), loose: false };
  while ((m = kv.exec(text)))  yield { value: m[1].trim(), loose: false };
  // Loose fallback: "Key <token>" — only used if nothing else matched.
  const loose = new RegExp(`\\b${k}\\b[^\\w]{0,4}([A-Za-z0-9_./-]{2,})`, "gi");
  while ((m = loose.exec(text))) yield { value: m[1].trim(), loose: true };
}

function firstPair(text: string, key: string): { value: string; confidence: CcpConfidence } {
  const it = findPairs(text, key);
  const first = it.next();
  if (first.done) return { value: "", confidence: "unknown" };
  return { value: first.value.value, confidence: first.value.loose ? "low" : "high" };
}

function hasAny(text: string, ...keys: string[]): boolean {
  return keys.some((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
}

/**
 * Split the CCP text into "blocks" around well-known section markers
 * (Controller, Room, Device, Zone, GroupSignal, CallType, Output, Cancel).
 * Each block carries a coarse "kind" so the per-entity extractor can scan
 * a smaller window and avoid cross-contamination between sections.
 */
type Block = { kind: string; body: string };

function splitBlocks(text: string): Block[] {
  const markers = [
    "Controller", "Room", "Location", "Device", "Callpoint", "Pendant",
    "Zone", "GroupSignal", "Group Signal", "CallType", "Call Type",
    "Output", "OutputRule", "Cancel", "CancelRule", "Link",
  ];
  const re = new RegExp(`(?:^|\\n|<)\\s*(${markers.map((m) => m.replace(/\\s/g, "\\s")).join("|")})\\b`, "gi");
  const blocks: Block[] = [];
  let last: { kind: string; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (last) blocks.push({ kind: last.kind, body: text.slice(last.start, m.index) });
    last = { kind: m[1].replace(/\s+/g, ""), start: m.index };
  }
  if (last) blocks.push({ kind: last.kind, body: text.slice(last.start) });
  return blocks;
}

/** Find the 1-based line number for a given character offset. */
function lineOf(text: string, offset: number): number {
  if (offset <= 0) return 1;
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function isValidIp(ip: string): boolean {
  if (!ip || ip === "unknown") return false;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((p) => {
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/* -------------------------------------------------------------- */
/* Per-entity extractors                                          */
/* -------------------------------------------------------------- */

function extractControllers(blocks: Block[]): CcpController[] {
  const out: CcpController[] = [];
  for (const b of blocks) {
    if (!/controller/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name");
    const id   = firstPair(b.body, "ControllerID").value
              || firstPair(b.body, "Controller_Id").value
              || firstPair(b.body, "Id").value;
    const ip   = firstPair(b.body, "IP").value
              || firstPair(b.body, "Address").value;
    const loc  = firstPair(b.body, "Location").value
              || firstPair(b.body, "Site").value;
    if (!name.value && !id) continue;
    const fields = [name.value, id, ip].filter(Boolean).length;
    const confidence: CcpConfidence =
      fields >= 3 ? "high" : fields === 2 ? "medium" : "low";
    out.push({
      name: name.value || "unknown",
      controllerId: id || "unknown",
      ip: ip || "unknown",
      location: loc || "unknown",
      confidence,
    });
  }
  return dedupe(out, (c) => `${c.controllerId}|${c.name}`);
}

function extractRooms(blocks: Block[]): CcpRoom[] {
  const out: CcpRoom[] = [];
  for (const b of blocks) {
    if (!/room|location/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name").value || firstPair(b.body, "RoomName").value;
    const path = firstPair(b.body, "Path").value || firstPair(b.body, "Location").value;
    if (!name) continue;
    out.push({
      name, path: path || "unknown",
      assignedDevices: [],
      confidence: path ? "medium" : "low",
    });
  }
  return dedupe(out, (r) => r.name);
}

function extractDevices(blocks: Block[]): CcpDevice[] {
  const out: CcpDevice[] = [];
  for (const b of blocks) {
    if (!/device|callpoint|pendant/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name").value;
    const type = firstPair(b.body, "Type").value || (b.kind.match(/Callpoint|Pendant/i)?.[0] ?? "");
    const addr = firstPair(b.body, "Address").value || firstPair(b.body, "IPnetAddress").value;
    const ctrl = firstPair(b.body, "ControllerID").value || firstPair(b.body, "Controller").value;
    const room = firstPair(b.body, "Room").value || firstPair(b.body, "Location").value;
    const cts  = firstPair(b.body, "CallType").value || firstPair(b.body, "CallTypes").value;
    if (!name && !addr) continue;
    const fields = [name, type, addr, ctrl, room].filter(Boolean).length;
    out.push({
      name: name || "unknown",
      type: type || "unknown",
      address: addr || "unknown",
      controllerId: ctrl || "unknown",
      room: room || "unknown",
      callTypes: cts ? cts.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [],
      confidence: fields >= 4 ? "high" : fields >= 2 ? "medium" : "low",
    });
  }
  return out;
}

function extractZones(blocks: Block[]): CcpZone[] {
  const out: CcpZone[] = [];
  for (const b of blocks) {
    if (!/zone/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name").value || firstPair(b.body, "ZoneName").value;
    const type = firstPair(b.body, "Type").value || "Room";
    const ctrl = firstPair(b.body, "ControllerID").value || firstPair(b.body, "Controller").value;
    if (!name) continue;
    out.push({ name, type, controllerId: ctrl || "unknown", confidence: ctrl ? "high" : "medium" });
  }
  return dedupe(out, (z) => z.name);
}

function extractGroupSignals(blocks: Block[]): CcpGroupSignal[] {
  const out: CcpGroupSignal[] = [];
  for (const b of blocks) {
    if (!/groupsignal|group/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name").value || firstPair(b.body, "GroupName").value;
    const target = firstPair(b.body, "Target").value || firstPair(b.body, "Output").value
                || firstPair(b.body, "TargetOutput").value;
    const tctl = firstPair(b.body, "TargetController").value;
    const zones = firstPair(b.body, "Zones").value || firstPair(b.body, "IncludedZones").value;
    if (!name) continue;
    out.push({
      name,
      includedZones: zones ? zones.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [],
      targetOutput: target || "unknown",
      targetController: tctl || "unknown",
      confidence: target && (zones || tctl) ? "high" : target ? "medium" : "low",
    });
  }
  return dedupe(out, (g) => g.name);
}

function extractCallTypes(blocks: Block[]): CcpCallType[] {
  const out: CcpCallType[] = [];
  for (const b of blocks) {
    if (!/calltype/i.test(b.kind)) continue;
    const name = firstPair(b.body, "Name").value;
    const prio = firstPair(b.body, "Priority").value;
    const cat  = firstPair(b.body, "Category").value || firstPair(b.body, "Type").value;
    const cg   = firstPair(b.body, "CancelGroup").value;
    const pg   = firstPair(b.body, "ProtectGroup").value;
    const dg   = firstPair(b.body, "DisableGroup").value;
    if (!name) continue;
    const priority = prio && /^\d+$/.test(prio) ? Number(prio) : null;
    out.push({
      name, priority, category: cat || "unknown",
      cancelGroup: cg || "unknown", protectGroup: pg || "unknown", disableGroup: dg || "unknown",
      confidence: priority !== null && cat ? "high" : "medium",
    });
  }
  return dedupe(out, (c) => c.name);
}

function extractOutputRules(blocks: Block[]): CcpOutputRule[] {
  const out: CcpOutputRule[] = [];
  for (const b of blocks) {
    if (!/output|link/i.test(b.kind)) continue;
    const src = firstPair(b.body, "Source").value || firstPair(b.body, "From").value;
    const tgt = firstPair(b.body, "Target").value || firstPair(b.body, "To").value;
    if (!src && !tgt) continue;
    out.push({
      source: src || "unknown", target: tgt || "unknown",
      confidence: src && tgt ? "high" : "low",
    });
  }
  return out;
}

function extractCancelRules(blocks: Block[]): CcpCancelRule[] {
  const out: CcpCancelRule[] = [];
  for (const b of blocks) {
    if (!/cancel/i.test(b.kind)) continue;
    const src = firstPair(b.body, "Source").value || firstPair(b.body, "From").value;
    const cancels = firstPair(b.body, "Cancels").value || firstPair(b.body, "Target").value;
    if (!src && !cancels) continue;
    out.push({
      source: src || "unknown", cancels: cancels || "unknown",
      confidence: src && cancels ? "high" : "low",
    });
  }
  return out;
}

function dedupe<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* -------------------------------------------------------------- */
/* Public API                                                     */
/* -------------------------------------------------------------- */

export function parseCcp(text: string | undefined | null): CcpParseResult {
  const t0 = Date.now();
  const safeText = typeof text === "string" ? text : "";
  const rawSize = safeText.length;
  const linesRead = safeText ? safeText.split(/\r?\n/).length : 0;

  const baseMetrics: CcpParserMetrics = {
    linesRead, matchedSections: 0, unknownSections: 0,
    recoveredSections: 0, malformedSections: 0, parseDurationMs: 0,
  };

  if (!safeText.trim()) {
    return {
      ...EMPTY_PARSE,
      rawSize,
      parserMetrics: { ...baseMetrics, parseDurationMs: Date.now() - t0 },
      parserVersion: PARSER_VERSION,
    };
  }

  // Sanity: does the text even smell like a Tacera/IPConnect CCP?
  const smells = (() => {
    try { return hasAny(safeText, "Controller", "Callpoint", "IPnet", "GroupSignal", "Tacera", "IPConnect"); }
    catch { return false; }
  })();
  if (!smells) {
    return {
      ...EMPTY_PARSE,
      status: "parse_failed",
      warnings: ["File does not appear to contain Tacera/IPConnect CCP markers."],
      structuredWarnings: [{
        code: "no_ccp_markers",
        severity: "CRITICAL",
        title: "No Tacera/IPConnect markers found",
        explanation: "The file lacks recognizable CCP keywords (Controller, Callpoint, IPnet, GroupSignal, Tacera, IPConnect). It may not be a CCP export.",
        affectedObject: "",
        rawEvidence: safeText.slice(0, 200),
      }],
      rawSize,
      rawUnparsed: [safeText.slice(0, 1000)],
      parserMetrics: { ...baseMetrics, malformedSections: 1, parseDurationMs: Date.now() - t0 },
      confidenceScore: 0,
      parserVersion: PARSER_VERSION,
    };
  }

  const warnings: string[] = [];
  const structuredWarnings: CcpWarning[] = [];

  let blocks: Block[] = [];
  try {
    blocks = splitBlocks(safeText);
  } catch (err) {
    structuredWarnings.push({
      code: "parser_exception",
      severity: "WARNING",
      title: "Section splitter recovered from an exception",
      explanation: err instanceof Error ? err.message : String(err),
      affectedObject: "",
      rawEvidence: "",
    });
    blocks = [];
  }

  let recoveredSections = 0;
  if (blocks.length === 0) {
    warnings.push("No section markers found — parser fell back to whole-document scan.");
    structuredWarnings.push({
      code: "no_section_markers",
      severity: "WARNING",
      title: "No section markers found",
      explanation: "Parser could not find Controller/Device/Room markers; falling back to a whole-document scan. Extracted entities may be incomplete.",
      affectedObject: "",
      rawEvidence: safeText.slice(0, 200),
    });
    blocks.push({ kind: "Document", body: safeText });
    recoveredSections = 1;
  }

  // Run each extractor in isolation so a single bug never crashes the import.
  const safe = <T,>(fn: () => T[], code: CcpWarningCode, label: string): T[] => {
    try { return fn(); } catch (err) {
      structuredWarnings.push({
        code, severity: "WARNING",
        title: `Extractor recovered: ${label}`,
        explanation: err instanceof Error ? err.message : String(err),
        affectedObject: "", rawEvidence: "",
      });
      return [];
    }
  };

  const controllers  = safe(() => extractControllers(blocks),  "parser_exception", "controllers");
  const rooms        = safe(() => extractRooms(blocks),        "parser_exception", "rooms");
  const devices      = safe(() => extractDevices(blocks),      "parser_exception", "devices");
  const zones        = safe(() => extractZones(blocks),        "parser_exception", "zones");
  const groupSignals = safe(() => extractGroupSignals(blocks), "parser_exception", "groupSignals");
  const callTypes    = safe(() => extractCallTypes(blocks),    "parser_exception", "callTypes");
  const outputRules  = safe(() => extractOutputRules(blocks),  "parser_exception", "outputRules");
  const cancelRules  = safe(() => extractCancelRules(blocks),  "parser_exception", "cancelRules");

  /* === Cross-entity validation === */
  const seenIds = new Map<string, number>();
  const seenIps = new Map<string, number>();
  for (const c of controllers) {
    if (c.controllerId && c.controllerId !== "unknown") {
      seenIds.set(c.controllerId, (seenIds.get(c.controllerId) || 0) + 1);
    }
    if (c.ip && c.ip !== "unknown") {
      if (!isValidIp(c.ip)) {
        structuredWarnings.push({
          code: "invalid_ip", severity: "WARNING",
          title: `Controller ${c.controllerId || c.name} has an invalid IP`,
          explanation: `Value "${c.ip}" is not a valid IPv4 address.`,
          affectedObject: `controller:${c.controllerId || c.name}`,
          rawEvidence: c.ip,
        });
      } else {
        seenIps.set(c.ip, (seenIps.get(c.ip) || 0) + 1);
      }
    }
    if (c.confidence === "low") {
      structuredWarnings.push({
        code: "low_confidence_match", severity: "INFO",
        title: `Low-confidence controller: ${c.name || c.controllerId}`,
        explanation: "Parser inferred fields loosely. Verify against the live CCP.",
        affectedObject: `controller:${c.controllerId || c.name}`,
        rawEvidence: "",
      });
    }
  }
  for (const [id, count] of seenIds) if (count > 1) {
    structuredWarnings.push({
      code: "duplicate_controller_id", severity: "CRITICAL",
      title: `Duplicate controller ID: ${id}`,
      explanation: `Controller ID "${id}" appears ${count} times. Each controller must be unique.`,
      affectedObject: `controller:${id}`,
      rawEvidence: "",
    });
  }
  for (const [ip, count] of seenIps) if (count > 1) {
    structuredWarnings.push({
      code: "duplicate_controller_ip", severity: "CRITICAL",
      title: `Duplicate controller IP: ${ip}`,
      explanation: `IP "${ip}" is assigned to ${count} controllers. IP collisions break routing.`,
      affectedObject: `ip:${ip}`,
      rawEvidence: "",
    });
  }

  const ctrlIds = new Set(controllers.map((c) => c.controllerId).filter((x) => x && x !== "unknown"));
  for (const d of devices) {
    if (d.controllerId === "unknown") {
      structuredWarnings.push({
        code: "orphan_device", severity: "WARNING",
        title: `Orphan device: ${d.name || d.address}`,
        explanation: "Device has no controller reference.",
        affectedObject: `device:${d.address || d.name}`,
        rawEvidence: "",
      });
    } else if (ctrlIds.size > 0 && !ctrlIds.has(d.controllerId)) {
      structuredWarnings.push({
        code: "unknown_controller_reference", severity: "WARNING",
        title: `Device references unknown controller: ${d.controllerId}`,
        explanation: `Device "${d.name || d.address}" points at controller "${d.controllerId}" but no such controller was parsed.`,
        affectedObject: `device:${d.address || d.name}`,
        rawEvidence: d.controllerId,
      });
    }
    if (d.room === "unknown") {
      structuredWarnings.push({
        code: "missing_room_mapping", severity: "INFO",
        title: `Device missing room mapping: ${d.name || d.address}`,
        explanation: "No room/location associated with this device.",
        affectedObject: `device:${d.address || d.name}`,
        rawEvidence: "",
      });
    }
  }

  // Detect unparsed sections (lines that look section-y but didn't match)
  const rawUnparsed: string[] = [];
  let unknownSections = 0;
  try {
    const sectionLike = safeText.match(/^[\s<]*([A-Z][A-Za-z0-9_]{2,30})\b/gm) || [];
    const known = /^(controller|room|location|device|callpoint|pendant|zone|group|calltype|output|cancel|link|name|id|ip|address|type|priority|category|target|source|path|notes?|description)$/i;
    const seen = new Set<string>();
    for (const s of sectionLike) {
      const tag = s.trim().replace(/^[<\s]+/, "");
      if (!tag || seen.has(tag) || known.test(tag)) continue;
      seen.add(tag);
      unknownSections++;
      if (rawUnparsed.length < 20) rawUnparsed.push(tag);
    }
    if (unknownSections > 0) {
      structuredWarnings.push({
        code: "unsupported_object_type", severity: "INFO",
        title: `Unsupported sections detected (${unknownSections})`,
        explanation: `Parser saw section-like tokens it does not understand: ${rawUnparsed.slice(0, 10).join(", ")}`,
        affectedObject: "",
        rawEvidence: rawUnparsed.slice(0, 10).join(", "),
      });
    }
  } catch { /* never crash */ }

  // Roll up overall confidence.
  const all = [
    ...controllers, ...rooms, ...devices, ...zones,
    ...groupSignals, ...callTypes, ...outputRules, ...cancelRules,
  ];
  const score = (c: CcpConfidence) => c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
  const avg = all.length ? all.reduce((a, x) => a + score(x.confidence), 0) / all.length : 0;
  const confidenceScore = Math.round((avg / 3) * 100);
  const overall: CcpConfidence =
    all.length === 0 ? "unknown" :
    avg >= 2.5 ? "high" : avg >= 1.5 ? "medium" : "low";

  const hasCritical = structuredWarnings.some((w) => w.severity === "CRITICAL");
  const status: CcpParseStatus =
    all.length === 0 ? "parse_failed" :
    (overall === "low" || overall === "unknown" || hasCritical) ? "parsed_low_confidence" :
    "parsed";

  if (status === "parsed_low_confidence") {
    warnings.push("Parser confidence is low — verify entities against the live CCP.");
    if (!structuredWarnings.some((w) => w.code === "partial_parse")) {
      structuredWarnings.push({
        code: "partial_parse", severity: "WARNING",
        title: "Partial parse — manual review required",
        explanation: `Overall confidence is ${overall} (${confidenceScore}%). Review entities before importing.`,
        affectedObject: "", rawEvidence: "",
      });
    }
  }

  const matchedSections = blocks.length - recoveredSections;
  const parserMetrics: CcpParserMetrics = {
    linesRead,
    matchedSections: Math.max(matchedSections, 0),
    unknownSections,
    recoveredSections,
    malformedSections: 0,
    parseDurationMs: Date.now() - t0,
  };

  return {
    status, confidence: overall,
    controllers, rooms, devices, zones,
    groupSignals, callTypes, outputRules, cancelRules,
    warnings, rawSize,
    structuredWarnings, rawUnparsed,
    parserMetrics, confidenceScore,
    parserVersion: PARSER_VERSION,
  };
}

/** Top-level guard so callers never see an exception, even on truly broken input. */
export function parseCcpSafe(text: string | undefined | null): CcpParseResult {
  try { return parseCcp(text); }
  catch (err) {
    return {
      ...EMPTY_PARSE,
      status: "parse_failed",
      warnings: [`Parser exception: ${err instanceof Error ? err.message : String(err)}`],
      structuredWarnings: [{
        code: "parser_exception", severity: "CRITICAL",
        title: "Parser exception",
        explanation: err instanceof Error ? err.message : String(err),
        affectedObject: "", rawEvidence: "",
      }],
      parserVersion: PARSER_VERSION,
    };
  }
}

// Silence unused-helper warnings for utilities exported for future use.
void lineOf;