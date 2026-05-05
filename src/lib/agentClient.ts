/**
 * Client for the local Tacera Doctor agent (Node, port 3001 by default).
 * Frontend is the Vite app served on port 8080. The browser calls the
 * agent directly over HTTP. URL is configurable in the UI.
 */

import { getBackendUrl, type SiteConfig, type DiagnosisResult, type LogResult, type ServiceEntry } from "./siteConfig";

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

export type LogPullFile = { path: string; ok: boolean; sizeBytes?: number; truncated?: boolean; content?: string; reason?: string; error?: string };
export type LogPullResult = { ok: boolean; connected?: boolean; stage?: string; error?: string; files: LogPullFile[]; host?: string; port?: number; at?: string };

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
  | { ok: true; mode: "LOCAL_OLLAMA"; endpoint: string; model: string; ai: AiExplanation; notice: string }
  | { ok: false; reason: string; message: string; endpoint?: string; model?: string };

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
