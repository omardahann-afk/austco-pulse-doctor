/**
 * Live Capture Client
 * -------------------
 * Thin typed wrapper over the M1/M2 live-capture endpoints. Every call hits
 * a real backend route through the TanStack proxy under /api/live-capture/*.
 * No fabrication, no client-side fallback diagnosis.
 */

export type CaptureStatus =
  | "idle"
  | "capturing"
  | "reproduction_active"
  | "stopped"
  | "analyzing"
  | "complete"
  | "failed";

export interface CaptureDeviceRef {
  id: string;
  name?: string;
  kind?: string;
  host?: string;
  applianceType?: string;
}

export interface CaptureCounters {
  rawEvidenceCount: number;
  normalizedEventCount: number;
  errorCount: number;
  warningCount: number;
  affectedCallpoints: string[];
  affectedAppliances: string[];
  distinctEventTypes: string[];
}

export interface CaptureSession {
  sessionId: string;
  status: CaptureStatus;
  createdAt: string;
  startedAt: string;
  reproductionStartedAt: string | null;
  reproductionEndedAt: string | null;
  stoppedAt: string | null;
  problemStatement: string;
  room: string;
  callpoint: string;
  expectedBehavior: string;
  actualBehavior: string;
  technicianNotes: string;
  devicesIncluded: CaptureDeviceRef[];
  rawEvidence?: Array<Record<string, unknown>>;
  normalizedEvents?: Array<Record<string, unknown>>;
  incidentChains?: unknown[];
  diagnosisResult?: DiagnosisResult | null;
  developerPackage?: DeveloperPackage | null;
}

export interface SignalPathHop {
  layerId: string;
  label: string;
  status: "ok" | "failed" | "no_evidence";
  eventCount: number;
  failureCount: number;
  ackCount: number;
  firstFailureAt: string | null;
}

export interface SignalPathResult {
  signalPath: SignalPathHop[];
  brokenHop: string | null;
  firstMissingAck: string | null;
  propagationStop: string | null;
  downstreamSymptoms: string[];
}

export interface DiagnosisResult {
  rootCause: { applianceType: string; kind: string; summary: string; evidenceEventIds: string[] } | null;
  firstFailurePoint: {
    applianceType: string | null;
    eventType: string | null;
    timestamp: string | null;
    rawMessage: string | null;
    eventId: string | null;
  } | null;
  downstreamSymptoms: Array<{
    eventId: string; applianceType: string; eventType: string; timestamp: string; rawMessage: string;
  }>;
  contradictions: Array<{ kind: string; detail: string }>;
  confidence: number;
  confidenceBreakdown: Array<{ reason: string; delta: number }>;
  nextChecks: string[];
  doNotDo: string[];
  ruledOut: string[];
  bootRecoveryWindows: Array<{ applianceType: string; from: string | null; to: string | null }>;
  evidenceTimeline: Array<{
    timestamp: string; applianceType: string; eventType: string; severity: string;
    callpointId: string | null; rawMessage: string; eventId: string;
  }>;
  affectedCallpoints: string[];
  affectedControllers: string[];
  affectedRooms: string[];
  signalPath?: SignalPathResult;
  incidentChains?: unknown[];
  correlationStory?: CorrelationStory;
}

export type IncidentClassification =
  | "first_failure"
  | "root_cause_evidence"
  | "downstream_symptom"
  | "supporting_evidence"
  | "contradiction"
  | "missing_evidence"
  | "noise";

export type ApplianceClassification =
  | "likely_root_cause"
  | "evidence_holder"
  | "downstream_symptom"
  | "contributing_factor"
  | "no_relevant_evidence"
  | "missing_evidence_needed"
  | "unknown";

export type CauseSymptomClassification = "cause" | "symptom" | "unknown" | "missing_evidence";

export interface IncidentSequenceItem {
  order: number;
  timestamp: string;
  appliance: string;
  applianceType: string;
  eventType: string;
  severity: string;
  summary: string;
  whyItMatters: string;
  classification: IncidentClassification;
}

export interface ApplianceBreakdownItem {
  appliance: string;
  applianceType: string;
  role: string;
  firstRelevantEvent: { timestamp: string; eventType: string; rawMessage: string } | null;
  eventCount: number;
  classification: ApplianceClassification;
  explanation: string;
  whatItProves: string;
  whatItDoesNotProve: string;
  nextCheck: string;
}

export interface CauseVsSymptomItem {
  appliance: string;
  applianceType: string;
  timing: string;
  evidence: string;
  classification: CauseSymptomClassification;
  explanation: string;
}

export interface CorrelationStory {
  plainEnglishSummary: string;
  whyThisMatters: string;
  whatHappenedFirst: {
    timestamp: string;
    appliance: string;
    applianceType: string;
    eventType: string;
    rawMessage: string;
    whyItMatters: string;
  } | null;
  incidentSequence: IncidentSequenceItem[];
  applianceBreakdown: ApplianceBreakdownItem[];
  causeVsSymptom: CauseVsSymptomItem[];
  missingEvidence: string[];
  technicianConclusion: string;
  developerConclusion: string;
  customerSafeConclusion: string;
}

export interface DeveloperPackage {
  formatVersion: number;
  generatedAt: string;
  capture: Record<string, unknown>;
  rootCause: DiagnosisResult["rootCause"];
  firstFailurePoint: DiagnosisResult["firstFailurePoint"];
  confidence: number | null;
  confidenceBreakdown: DiagnosisResult["confidenceBreakdown"];
  contradictions: DiagnosisResult["contradictions"];
  ruledOut: string[];
  nextChecks: string[];
  doNotDo: string[];
  signalPath: SignalPathHop[];
  propagation: {
    brokenHop: string | null;
    firstMissingAck: string | null;
    propagationStop: string | null;
    downstreamSymptomLayers: string[];
  };
  evidenceTimeline: DiagnosisResult["evidenceTimeline"];
  downstreamSymptoms: DiagnosisResult["downstreamSymptoms"];
  rawEvidenceCount: number;
  normalizedEventCount: number;
  correlationStory: CorrelationStory | null;
  deterministicReasoning: string[];
}

export interface CaptureEnvelope {
  ok: boolean;
  session?: CaptureSession;
  counters?: CaptureCounters;
  diagnosis?: DiagnosisResult;
  signalPath?: SignalPathResult;
  developerPackage?: DeveloperPackage;
  ingested?: { raw: number; events: number };
  reason?: string;
  message?: string;
}

async function call(path: string, init?: RequestInit): Promise<CaptureEnvelope> {
  const res = await fetch(path, {
    method: init?.method || "GET",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: init?.body,
  });
  const text = await res.text();
  let json: CaptureEnvelope;
  try {
    json = JSON.parse(text) as CaptureEnvelope;
  } catch {
    throw new Error(`Non-JSON response from ${path} (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || json.reason || `HTTP ${res.status}`);
  }
  return json;
}

export const liveCapture = {
  start: (input: {
    problemStatement: string; room?: string; callpoint?: string;
    expectedBehavior?: string; actualBehavior?: string; technicianNotes?: string;
    devicesIncluded: string[];
  }) =>
    call("/api/live-capture/start", { method: "POST", body: JSON.stringify(input) }),
  get: (id: string) => call(`/api/live-capture/${encodeURIComponent(id)}`),
  markReproStarted: (id: string) =>
    call(`/api/live-capture/${encodeURIComponent(id)}/mark-reproduction-started`, { method: "POST", body: "{}" }),
  markReproFinished: (id: string) =>
    call(`/api/live-capture/${encodeURIComponent(id)}/mark-reproduction-finished`, { method: "POST", body: "{}" }),
  stop: (id: string) =>
    call(`/api/live-capture/${encodeURIComponent(id)}/stop`, { method: "POST", body: "{}" }),
  ingestLogs: (id: string, body: { lines?: number; sshPasswords?: Record<string, string> } = {}) =>
    call(`/api/live-capture/${encodeURIComponent(id)}/ingest-logs`, { method: "POST", body: JSON.stringify(body) }),
  analyze: (id: string) =>
    call(`/api/live-capture/${encodeURIComponent(id)}/analyze`, { method: "POST", body: "{}" }),
};

export interface AiExplanationPayload {
  diagnosis: DiagnosisResult;
  developerPackage: DeveloperPackage;
  confidenceBreakdown: DiagnosisResult["confidenceBreakdown"];
  doNotDo: string[];
  correlation?: unknown;
}

export async function requestAiExplanation(payload: AiExplanationPayload): Promise<{ ok: boolean; response?: unknown; message?: string }> {
  const res = await fetch("/api/ai/root-cause-assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alert: payload }),
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, message: `Non-JSON response (HTTP ${res.status})` }; }
}