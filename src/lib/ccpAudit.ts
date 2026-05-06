/**
 * CCP import audit trail (localStorage-backed, capped to last 50 entries).
 * Each entry stores a sanitized snapshot of the import so the user can
 * review history, compare imports, or restore a prior config.
 */
import type { SiteConfig } from "./siteConfig";
import type { CcpParseResult, CcpWarning } from "./ccpParser";

const AUDIT_KEY = "tacera.ccpAudit.v1";
const MAX_ENTRIES = 50;

export type CcpAuditEntry = {
  auditId: string;
  timestamp: string;
  filename: string;
  fileType: "ccp" | "json" | "unknown";
  parserVersion: string;
  parseConfidence: string;       // "high" | "medium" | "low" | "unknown"
  confidenceScore: number;       // 0-100
  status: string;                // "imported" | "preview_cancelled" | "low_confidence" | "failed"
  importedControllers: number;
  importedDevices: number;
  importedRooms: number;
  warnings: CcpWarning[];
  checksum: string;              // simple FNV-1a hex of file content
  importedBy: string;
  durationMs: number;
  /** Snapshot of SiteConfig BEFORE the import (so we can restore). */
  previousConfigSnapshot?: SiteConfig | null;
  /** Snapshot of SiteConfig AFTER the import (for re-application). */
  newConfigSnapshot?: SiteConfig | null;
};

export function loadAudit(): CcpAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as CcpAuditEntry[] : [];
  } catch { return []; }
}

export function saveAuditEntry(entry: CcpAuditEntry): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadAudit();
    all.unshift(entry);
    const trimmed = all.slice(0, MAX_ENTRIES);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

export function clearAudit(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(AUDIT_KEY); } catch { /* noop */ }
}

export function newAuditId(): string {
  return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Tiny FNV-1a hash for content fingerprinting (not crypto). */
export function checksumOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function buildAuditFromParse(opts: {
  filename: string;
  fileType: "ccp" | "json" | "unknown";
  parsed: CcpParseResult;
  status: CcpAuditEntry["status"];
  rawText: string;
  technician: string;
  durationMs: number;
  previousConfig: SiteConfig | null;
  newConfig: SiteConfig | null;
}): CcpAuditEntry {
  return {
    auditId: newAuditId(),
    timestamp: new Date().toISOString(),
    filename: opts.filename,
    fileType: opts.fileType,
    parserVersion: opts.parsed.parserVersion || "unknown",
    parseConfidence: opts.parsed.confidence,
    confidenceScore: opts.parsed.confidenceScore ?? 0,
    status: opts.status,
    importedControllers: opts.parsed.controllers.length,
    importedDevices: opts.parsed.devices.length,
    importedRooms: opts.parsed.rooms.length,
    warnings: opts.parsed.structuredWarnings || [],
    checksum: checksumOf(opts.rawText),
    importedBy: opts.technician || "technician",
    durationMs: opts.durationMs,
    previousConfigSnapshot: opts.previousConfig,
    newConfigSnapshot: opts.newConfig,
  };
}