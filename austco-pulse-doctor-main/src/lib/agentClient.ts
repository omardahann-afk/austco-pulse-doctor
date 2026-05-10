/**
 * Client for the local Tacera Doctor agent (Node, port 3001 by default).
 * Frontend is the Vite app served on port 8080. The browser calls the
 * agent directly over HTTP. URL is configurable in the UI.
 */

import { getBackendUrl, type SiteConfig, type DiagnosisResult, type LogResult, type ServiceEntry, type RootCauseAnalysis } from "./siteConfig";

export type AgentHealth = {
  ok: true;
  service: string;
  version: string;
  vm: { hostname: string; addrs: string[]; platform: string };
  time: string;
};

export async function checkHealth(timeoutMs = 2500): Promise<{ ok: true; data: AgentHealth } | { ok: false; error: string }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/health";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as AgentHealth };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally { clearTimeout(t); }
}

type ApiError = { ok: false; reason: string; message: string };

export async function runDiagnosis(siteConfig: SiteConfig): Promise<DiagnosisResult | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/diagnosis/run";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteConfig }),
  });
  return await res.json();
}

export type LogUpload = { name: string; type: string; content: string };
export async function analyzeLogs(files: LogUpload[]): Promise<LogResult | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/logs/analyze";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  return await res.json();
}

/* ===== SSH/service endpoints ===== */

export type SshTestResult =
  | { ok: true; host: string; port: number; username: string; at: string }
  | { ok: false; stage: string; error: string; host?: string; port?: number; username?: string; at?: string };

export async function testSsh(svc: { host: string; port?: number; username: string; password: string }): Promise<SshTestResult> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/ssh/test";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(svc),
  });
  return await res.json();
}

export type LogPullFile = { path: string; inputPath?: string; ok: boolean; sizeBytes?: number; truncated?: boolean; content?: string; reason?: string; error?: string };
export type LogPathExpansion = {
  input: string;
  kind: "file" | "directory" | "glob" | "unknown" | "invalid";
  ok: boolean;
  discovered: number;
  pulled: number;
  skipped: number;
  error?: string;
  reason?: string;
};
export type LogPullResult = { ok: boolean; connected?: boolean; stage?: string; error?: string; files: LogPullFile[]; expansions?: LogPathExpansion[]; host?: string; port?: number; at?: string };

export async function pullLogsViaSsh(opts: { host: string; port?: number; username: string; password: string; paths: string[] }): Promise<LogPullResult> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/ssh/pull-logs";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return await res.json();
}

export type ServiceStep = { name: string; status: "PASS" | "WARN" | "FAIL" | "UNKNOWN"; detail: string; at: string };
export type LogFinding = {
  type: string;
  message: string;
  timestamp: string | null;
  raw: string;
  line?: number;
  severity?: "ERROR" | "WARN" | "INFO";
};
export type ParsedLog = {
  path: string;
  inputPath?: string;
  ok: boolean;
  reason?: string;
  error?: string;
  service?: string;
  sizeBytes?: number;
  truncated?: boolean;
  totalLines: number;
  errors: number;
  warnings: number;
  findings: LogFinding[];
};
export type ServiceDiagnosisResult = {
  serviceId: string;
  name: string;
  role: string;
  host: string;
  hostname: string;
  port: number;
  startedAt: string;
  finishedAt: string | null;
  connection: "ok" | "failed" | "unknown";
  steps: ServiceStep[];
  logs: LogPullFile[];
  parsed: { totalErrors: number; totalWarnings: number; typeCounts: Record<string, number> } | null;
  parsedLogs: ParsedLog[];
  expansions?: LogPathExpansion[];
  status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  message: string;
  source: "REAL TEST";
};

export type ServicesDiagnosis = {
  ok: true;
  mode: "REAL TEST";
  vm: { hostname: string; addrs: string[]; platform: string };
  startedAt: string;
  finishedAt: string;
  summary: { total: number; pass: number; warn: number; fail: number };
  breakFoundAt: { name: string; role: string; host: string } | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
  services: ServiceDiagnosisResult[];
  diagnosis?: AustcoDiagnosis;
  rootCause?: RootCauseAnalysis;
};

export type AustcoTraceStep = {
  label: string;
  role: string;
  status: "PASS" | "WARN" | "FAIL" | "NOT VERIFIED" | "UNKNOWN";
  evidence: string[];
  source: "REAL TEST" | "PULLED LOG";
};
export type AustcoDiagnosis = {
  mode: "REAL DIAGNOSIS";
  breakFoundAt: string;
  primaryCause: string;
  confidence: number;
  confidenceReasons: string[];
  evidence: string[];
  fixActions: string[];
  affectedServices: string[];
  traceSteps: AustcoTraceStep[];
  warnings: string[];
};

export type AiExplanation = {
  plainEnglishSummary: string;
  technicianExplanation: string;
  escalationSummary: string;
  customerFriendlySummary: string;
  safetyNotes: string;
};
export type AiExplainResult =
  | { ok: true; mode: "LOCAL_OLLAMA"; endpoint: string; model: string; ai: AiExplanation; notice: string; payload?: AiPayload }
  | { ok: false; reason: string; message: string; endpoint?: string; model?: string; payload?: AiPayload };

export type AiPayload = {
  breakFoundAt: string;
  primaryCause: string;
  confidence: number;
  confidenceReasons: string[];
  evidence: string[];
  fixActions: string[];
  affectedServices: string[];
};

export async function explainDiagnosis(opts: { diagnosis: AustcoDiagnosis; endpoint?: string; model?: string }): Promise<AiExplainResult> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/ai/explain";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return await res.json();
}

export async function diagnoseOneService(service: ServiceEntry): Promise<{ ok: true; vm: { hostname: string; addrs: string[]; platform: string }; service: ServiceDiagnosisResult } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/services/diagnose-one";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service }),
  });
  return await res.json();
}

export async function diagnoseServices(services: ServiceEntry[]): Promise<ServicesDiagnosis | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/services/diagnose";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ services }),
  });
  return await res.json();
}

/* ===== Trace Signal Path ===== */

export type TraceTargetKind =
  | "cpId" | "room" | "fqLocation" | "callType" | "mqtt" | "controllerId" | "auto";

export type TraceTargetInput = {
  kind: TraceTargetKind;
  value: string;
  callType?: string;
  fqLocation?: string;
  mqttTopic?: string;
  sinceMs?: number;
};

export type NormalizedTraceTarget = TraceTargetInput & { label: string };

export type TraceLayer =
  | "Input" | "Controller" | "IPConnect" | "Pulse Gateway" | "Integration Gateway"
  | "MQTT Broker" | "WebSocket MQTT Adapter" | "Display / IP-APP" | "External Systems";

export type TraceNodeStatus =
  | "SIGNAL_RECEIVED" | "EVENT_PROPAGATED" | "EVENT_ROUTED"
  | "TIMEOUT" | "CONFIG_MISMATCH" | "UNREACHABLE"
  | "NOT_CONFIGURED" | "NO_EVIDENCE" | "UNKNOWN"
  | "HOST_REACHABLE_PORT_CLOSED";

export type TraceNode = {
  layer: TraceLayer;
  componentType: string;
  componentName: string;
  status: TraceNodeStatus;
  evidence: string[];
  timestamp: string | null;
  latencyMs: number | null;
  nextHop: TraceLayer | null;
  breakDetected: boolean;
  confidence: number;
  reachable: boolean | null;
  evidenceSource?: "logs" | "deepEvidence" | "logs+deepEvidence";
};

export type SuspectedFailure = {
  layer: TraceLayer;
  componentName: string;
  reason: TraceNodeStatus;
  explanation: string;
  confidence: number;
};

export type TraceResult =
  | {
      ok: true;
      traceId: string;
      traceTarget: NormalizedTraceTarget;
      overallStatus: "PROPAGATED" | "PARTIAL" | "BROKEN" | "NO_EVIDENCE";
      signalStatus: "EVENT_ALIVE" | "PARTIAL_EVIDENCE" | "SIGNAL_LOST" | "NO_EVIDENCE";
      traceStartedAt: string;
      traceEndedAt: string;
      breakFoundAt: string | null;
      confidence: number;
      propagationPath: TraceNode[];
      evidence: string[];
      timing: { hops: { from: TraceLayer; to: TraceLayer; deltaMs: number }[] };
      suspectedFailures: SuspectedFailure[];
      ruledOutFailures: string[];
      fixActions: string[];
      notes: string[];
      vm?: { hostname: string; addrs: string[]; platform: string };
    }
  | ApiError;

export async function runTrace(opts: {
  target: TraceTargetInput;
  siteConfig: unknown;
  services?: ServiceEntry[];
  serviceResults?: ServiceDiagnosisResult[];
}): Promise<TraceResult> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/trace/run";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return await res.json();
}

/* ===== Autopilot ===== */

export type AutopilotRisk = "LOW" | "MEDIUM" | "HIGH";

export type AutopilotAction = {
  id: string;
  label: string;
  templateId: string;
  params: Record<string, unknown>;
  risk: AutopilotRisk;
  requiresSudo: boolean;
  command: string | null;
  blocked?: boolean;
  blockReason?: string;
  explanation: string;
  timeoutSeconds: number;
  verifyCommand: string | null;
  verifyExpect: string | null;
  rollbackCommand: string | null;
};

export type AutopilotPlan = {
  planId: string;
  createdAt: string;
  serviceId: string;
  serviceName: string;
  role: string;
  host: string;
  issueType: string;
  rootCause: string;
  confidence: number;
  riskLevel: AutopilotRisk;
  requiresApproval: true;
  summary: string;
  evidence: string[];
  actions: AutopilotAction[];
  verification: "automatic" | "manual";
  rollbackAvailable: boolean;
  manualNotes: string[];
  serviceRef: { id: string; host: string; port: number; username: string } | null;
  deepEvidenceUsed?: boolean;
  deepEvidenceSummary?: unknown;
  contradictions?: Array<{ kind: string; why: string; likelyLayer: string; confidence: number; sourceA: { layer: string; said: string }; sourceB: { layer: string; said: string }; target?: string | null }>;
  evidenceScore?: number;
  deepEvidenceCollectedAt?: string | null;
  mockEvidence?: boolean;
  mockTag?: string | null;
};

export type AutopilotIssue = {
  planId: string;
  serviceId: string;
  serviceName: string;
  role: string;
  host: string;
  severity: "FAIL" | "WARN" | "PASS" | "UNKNOWN";
  issueType: string;
  rootCause: string;
  confidence: number;
  riskLevel: AutopilotRisk;
};

export type AutopilotScan = {
  scanId: string;
  startedAt: string;
  finishedAt: string;
  monitoredCount: number;
  issueCount: number;
  issues: AutopilotIssue[];
  planIds: string[];
};

export type AutopilotStatus = {
  ok: true;
  loopRunning: boolean;
  intervalMs: number;
  lastScanAt: string | null;
  monitoredCount: number;
  currentIssueCount: number;
  lastScan: AutopilotScan | null;
  recentPlans: Array<Pick<AutopilotPlan, "planId" | "createdAt" | "serviceName" | "role" | "host" | "issueType" | "rootCause" | "riskLevel" | "confidence"> & { actionCount: number }>;
  recentExecutions: AutopilotExecutionReport[];
  recentScans: Array<Pick<AutopilotScan, "scanId" | "startedAt" | "finishedAt" | "monitoredCount" | "issueCount">>;
};

export type AutopilotActionResult = {
  actionId: string;
  label?: string;
  risk?: AutopilotRisk;
  command?: string;
  ok: boolean;
  reason?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  stage?: string | null;
  error?: string | null;
  before?: { ok: boolean; matched?: boolean; stdout?: string; stderr?: string } | null;
  verify?: { ok: boolean; matched?: boolean; stdout?: string; stderr?: string } | null;
  verifyCommand?: string | null;
  verifyExpect?: string | null;
};

export type AutopilotExecutionReport = {
  executionId: string;
  planId: string;
  startedAt: string;
  finishedAt: string;
  actionsRun: number;
  success: boolean;
  fixVerified?: boolean;
  commandOutputs: AutopilotActionResult[];
  verificationResult: unknown[];
  nextSteps: string[];
};

export async function autopilotGetStatus(): Promise<AutopilotStatus | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/status";
  const res = await fetch(url);
  return await res.json();
}

export async function autopilotScanNow(opts: { services: ServiceEntry[]; siteOverrides?: { systemd?: string[]; docker?: string[] } }): Promise<{ ok: true; scan: AutopilotScan } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/scan";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

export async function autopilotStart(opts: { services: ServiceEntry[]; siteOverrides?: { systemd?: string[]; docker?: string[] }; intervalMs?: number }): Promise<{ ok: true; alreadyRunning: boolean; intervalMs?: number } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/start";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

export async function autopilotStop(): Promise<{ ok: true } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/stop";
  const res = await fetch(url, { method: "POST" });
  return await res.json();
}

export async function autopilotGetPlan(planId: string): Promise<{ ok: true; plan: AutopilotPlan } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/plan";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
  return await res.json();
}

export async function autopilotListPlans(limit = 50): Promise<{ ok: true; plans: AutopilotPlan[] } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + `/api/autopilot/plans?limit=${limit}`;
  const res = await fetch(url);
  return await res.json();
}

export async function autopilotExecute(opts: { planId: string; actionIds?: string[]; password: string; acknowledged: boolean; approvalConfirmed?: boolean }): Promise<{ ok: true; report: AutopilotExecutionReport } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/execute";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalConfirmed: opts.acknowledged, ...opts }) });
  return await res.json();
}

export async function autopilotVerify(opts: { planId: string; password: string }): Promise<{ ok: true; report: AutopilotExecutionReport } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/verify";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

/* ===== Autopilot AI Copilot ===== */

export type AutopilotPlanExplanation = {
  plainEnglishSummary: string;
  whyThisMatched: string;
  riskExplanation: string;
  whatWillHappen: string;
  whatCouldGoWrong: string;
  approvalGuidance: string;
  escalationDraft: string;
  whyDeepEvidenceChangedConclusion?: string;
};

export type AutopilotExecExplanation = {
  resultSummary: string;
  whatChanged: string;
  verificationExplanation: string;
  remainingRisk: string;
  nextSteps: string;
  escalationUpdateDraft: string;
};

export type AutopilotAiResult<T> =
  | { ok: true; mode: "LOCAL_OLLAMA"; endpoint: string; model: string; ai: T; notice: string }
  | { ok: false; reason: string; message: string; endpoint?: string; model?: string };

export async function autopilotExplainPlan(opts: { planId: string; endpoint?: string; model?: string }): Promise<AutopilotAiResult<AutopilotPlanExplanation>> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/explain-plan";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

export async function autopilotExplainExecution(opts: { planId: string; report: AutopilotExecutionReport; endpoint?: string; model?: string }): Promise<AutopilotAiResult<AutopilotExecExplanation>> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/autopilot/explain-execution";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

/* ===== Deep Evidence ===== */

export type EvidenceContradiction = {
  kind: string;
  sourceA: { layer: string; said: string };
  sourceB: { layer: string; said: string };
  why: string;
  likelyLayer: string;
  confidence: number;
  target?: string;
  nextCheck?: string;
};

export type DeepEvidence = {
  collectedAt: string;
  finishedAt: string;
  mock?: boolean;
  mockTag?: string;
  mockDescription?: string;
  targets: Array<{ id: string; name: string; role: string; host: string; hostname: string; kind: string }>;
  networkTruth: { collectedAt: string; sourceVm: { interfaces: Array<{ iface: string; addr: string; mac: string }> }; targets: Array<Record<string, unknown>> };
  processTruth: { collectedAt: string; services: Array<Record<string, unknown>> };
  portTruth: { collectedAt: string; services: Array<Record<string, unknown>> };
  mqttTruth: { available: boolean; reason?: string; message?: string; eventCount?: number; silence?: boolean; topicCounts?: Record<string, number>; observedCpIds?: string[]; missingAcks?: string[]; ackTopic?: string | null };
  configTruth: { collectedAt: string; counts: Record<string, number>; issues: Array<{ kind: string; detail: string; target?: string }>; unknownCpIds: string[] };
  stateTruth: { collectedAt: string; available: boolean; note: string };
  contradictions: EvidenceContradiction[];
  rootCauseSignals: Array<{ layer: string; signal: string; target: string | null; confidence: number; message: string }>;
  traceSignals: Array<{ break: string; kind: string; target: string | null; evidence: string[] }>;
  evidenceScore: number;
};

export async function evidenceCollect(opts: { siteConfig: unknown; services: ServiceEntry[]; mqttSessionId?: string | null; recentLogFindings?: unknown[] }): Promise<{ ok: true; evidence: DeepEvidence } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/collect";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

export async function evidenceLatest(): Promise<{ ok: true; evidence: DeepEvidence } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/latest";
  const res = await fetch(url);
  return await res.json();
}

/* ===== DEV-only mock Deep Evidence scenarios ===== */
export type EvidenceScenario = { id: string; label: string };

export async function evidenceMockScenarios(): Promise<{ ok: true; scenarios: EvidenceScenario[] } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mock/scenarios";
  const res = await fetch(url);
  return await res.json();
}

export async function evidenceMockSet(scenarioId: string): Promise<{ ok: true; evidence: DeepEvidence } | ApiError> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mock/set";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId }) });
  return await res.json();
}

export async function evidenceMockClear(): Promise<{ ok: true; cleared: boolean }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mock/clear";
  const res = await fetch(url, { method: "POST" });
  return await res.json();
}

export async function mqttTapStart(opts: { brokerHost: string; brokerPort?: number; tls?: boolean; username?: string; password?: string; topic: string; durationSeconds?: number; ackTopic?: string }): Promise<{ ok: true; sessionId: string; expiresAt: string; startedAt: string } | { ok: false; reason: string; message: string }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mqtt/start";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  return await res.json();
}

export async function mqttTapStop(sessionId: string): Promise<{ ok: boolean; sessionId?: string; stoppedReason?: string; eventCount?: number; reason?: string }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mqtt/stop";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  return await res.json();
}

export async function mqttTapEvents(sessionId: string): Promise<{ ok: true; session: { sessionId: string; startedAt: string; expiresAt: string; connected: boolean; eventCount: number; events: Array<{ ts: string; topic: string; payloadSummary: string; correlations: Record<string, string> }> } } | { ok: false; reason: string }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/evidence/mqtt/events?sessionId=" + encodeURIComponent(sessionId);
  const res = await fetch(url);
  return await res.json();
}

/* ===== AI Evidence Commander ===== */

export type CommanderMode =
  | "explain_on_site"
  | "evidence_challenge"
  | "escalation_writer"
  | "root_cause_defender"
  | "fix_plan_explainer"
  | "post_fix_analyst";

export type CommanderFlags = {
  lowConfidence?: boolean;
  confidenceValue?: number | null;
  staleEvidence?: boolean;
  mockEvidence?: boolean;
};

export type CommanderResponse = {
  mode: CommanderMode | string;
  executiveSummary: string;
  technicianExplanation: string;
  evidenceThatMatters: string[];
  contradictions: string[];
  ruledOutCauses: string[];
  riskExplanation: string;
  recommendedNextStep: string;
  customerSafeSummary: string;
  internalTechnicalSummary: string;
  developerDebugSummary: string;
  confidenceWarning: string;
  safetyWarning: string;
  flags?: CommanderFlags;
  fallbackReason?: string;
};

export type CommanderContext = {
  rootCause?: unknown;
  trace?: unknown;
  deepEvidence?: unknown;
  plan?: unknown;
  execution?: unknown;
  contradictions?: unknown[];
  affectedServices?: string[];
  affectedHosts?: string[];
  affectedCpIds?: string[];
};

export type CommanderResult =
  | { ok: true; mode: CommanderMode; endpoint: string; model: string; response: CommanderResponse; notice: string }
  | { ok: false; reason: string; message: string; response: CommanderResponse };

export async function aiCommanderHealth(timeoutMs = 2500): Promise<{ ok: true; available: boolean; reason?: string } | { ok: false; error: string }> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/ai/commander/health";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally { clearTimeout(t); }
}

export async function aiCommanderRun(opts: { mode: CommanderMode; context: CommanderContext; endpoint?: string; model?: string }, timeoutMs = 35_000): Promise<CommanderResult> {
  const url = getBackendUrl().replace(/\/$/, "") + "/api/ai/commander";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as CommanderResult;
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "client_network_error",
      message: `AI Commander unreachable. Deterministic engine still active. (${msg})`,
      response: {
        mode: opts.mode,
        executiveSummary: "AI Commander unavailable.",
        technicianExplanation: "",
        evidenceThatMatters: [],
        contradictions: [],
        ruledOutCauses: [],
        riskExplanation: "",
        recommendedNextStep: "Retry AI analysis.",
        customerSafeSummary: "",
        internalTechnicalSummary: "",
        developerDebugSummary: "",
        confidenceWarning: "AI request failed.",
        safetyWarning: "Deterministic engine remains active.",
      },
    };
  } finally { clearTimeout(t); }
}
