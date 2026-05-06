/**
 * Sends a real .ccp (ZIP) file to the local agent's /api/ccp/parse endpoint
 * and returns the structured manifest. Falls back to a parse_failed shape if
 * the backend is unreachable so the UI can still show a useful preview.
 */
import { getBackendUrl } from "./siteConfig";
import type {
  CcpParseResult, CcpArchive, CcpPlugin, CcpEndpoint, CcpController,
  CcpDevice, CcpRoom, CcpZone,
} from "./ccpParser";
import { PARSER_VERSION } from "./ccpParser";

type BackendCcpResult = {
  parserStatus: "ccp_zip_detected" | "parsed" | "partial" | "parse_failed";
  parserVersion?: string;
  fileType?: "ccp" | "cnfg";
  filename?: string;
  archive: CcpArchive;
  plugins: CcpPlugin[];
  endpoints: CcpEndpoint[];
  controllers: Array<Partial<CcpController> & { sourceFile?: string }>;
  devices: Array<Partial<CcpDevice> & { sourceFile?: string }>;
  rooms: Array<Partial<CcpRoom> & { sourceFile?: string }>;
  zones: Array<Partial<CcpZone> & { sourceFile?: string }>;
  warnings: string[];
  unknown: Array<{ path: string; reason: string }>;
  durationMs?: number;
};

function backendBase(): string { return getBackendUrl().replace(/\/$/, ""); }

/** Detect the PK ZIP magic bytes in a File. */
export async function fileIsZip(file: File): Promise<boolean> {
  if (file.size < 4) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}

/** Convert backend response → CcpParseResult shape used across the UI. */
function normalize(b: BackendCcpResult, rawSize: number, durationMs: number): CcpParseResult {
  const controllers = (b.controllers || []).map((c) => ({
    name: c.name || "unknown",
    controllerId: c.controllerId || "unknown",
    ip: c.ip || "unknown",
    location: c.location || "unknown",
    confidence: (c.confidence as CcpController["confidence"]) || "medium",
  })) as CcpController[];
  const devices = (b.devices || []).map((d) => ({
    name: d.name || "unknown",
    type: d.type || "unknown",
    address: d.address || "unknown",
    controllerId: d.controllerId || "unknown",
    room: d.room || "unknown",
    callTypes: d.callTypes || [],
    confidence: (d.confidence as CcpDevice["confidence"]) || "medium",
  })) as CcpDevice[];
  const rooms = (b.rooms || []).map((r) => ({
    name: r.name || "unknown",
    path: r.path || "unknown",
    assignedDevices: r.assignedDevices || [],
    confidence: (r.confidence as CcpRoom["confidence"]) || "medium",
  })) as CcpRoom[];
  const zones = (b.zones || []).map((z) => ({
    name: z.name || "unknown",
    type: z.type || "Room",
    controllerId: z.controllerId || "unknown",
    confidence: (z.confidence as CcpZone["confidence"]) || "medium",
  })) as CcpZone[];

  const status = b.parserStatus;
  const totalEntities = controllers.length + devices.length + rooms.length + zones.length;

  return {
    status,
    confidence: status === "ccp_zip_detected" ? (totalEntities > 0 ? "medium" : "low") : "unknown",
    controllers, rooms, devices, zones,
    groupSignals: [], callTypes: [], outputRules: [], cancelRules: [],
    warnings: b.warnings || [],
    rawSize,
    structuredWarnings: (b.warnings || []).map((w) => ({
      code: "partial_parse" as const,
      severity: "INFO" as const,
      title: "Backend parser note",
      explanation: w,
      affectedObject: "",
      rawEvidence: "",
    })),
    rawUnparsed: (b.unknown || []).map((u) => `${u.path} — ${u.reason}`),
    parserMetrics: {
      linesRead: 0,
      matchedSections: b.archive?.xmlFileCount || 0,
      unknownSections: b.unknown?.length || 0,
      recoveredSections: 0,
      malformedSections: (b.archive?.files || []).filter((f) => f.error).length,
      parseDurationMs: durationMs,
    },
    confidenceScore: status === "ccp_zip_detected" ? 70 : 0,
    parserVersion: b.parserVersion || PARSER_VERSION,
    archive: b.archive,
    plugins: b.plugins || [],
    endpoints: b.endpoints || [],
    fileType: b.fileType || "ccp",
  };
}

export async function parseCcpZipViaBackend(file: File): Promise<CcpParseResult> {
  const t0 = Date.now();
  const fd = new FormData();
  fd.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(backendBase() + "/api/ccp/parse", { method: "POST", body: fd });
  } catch (err) {
    return failResult(file, `Local agent unreachable at ${backendBase()}: ${err instanceof Error ? err.message : String(err)}`, Date.now() - t0);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg += ` — ${j.message || j.reason || ""}`; } catch {}
    return failResult(file, msg, Date.now() - t0);
  }
  const json = await res.json();
  const b = json?.result as BackendCcpResult | undefined;
  if (!json?.ok || !b) return failResult(file, "Backend returned no result.", Date.now() - t0);
  return normalize(b, file.size, Date.now() - t0);
}

function failResult(file: File, message: string, durationMs: number): CcpParseResult {
  return {
    status: "parse_failed",
    confidence: "unknown",
    controllers: [], rooms: [], devices: [], zones: [],
    groupSignals: [], callTypes: [], outputRules: [], cancelRules: [],
    warnings: [message],
    rawSize: file.size,
    structuredWarnings: [{
      code: "parser_exception",
      severity: "CRITICAL",
      title: "CCP backend parse failed",
      explanation: message,
      affectedObject: "",
      rawEvidence: "",
    }],
    rawUnparsed: [],
    parserMetrics: { linesRead: 0, matchedSections: 0, unknownSections: 0, recoveredSections: 0, malformedSections: 1, parseDurationMs: durationMs },
    confidenceScore: 0,
    parserVersion: PARSER_VERSION,
    archive: { isZip: true, internalFileCount: 0, xmlFileCount: 0, files: [] },
    plugins: [],
    endpoints: [],
    fileType: "ccp",
  };
}