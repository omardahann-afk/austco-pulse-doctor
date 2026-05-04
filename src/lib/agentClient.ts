/**
 * Client for the local Tacera Doctor agent (Node, port 3001 by default).
 * Frontend is the Vite app served on port 8080. The browser calls the
 * agent directly over HTTP. URL is configurable in the UI.
 */

import { getBackendUrl, type SiteConfig, type DiagnosisResult, type LogResult } from "./siteConfig";

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
