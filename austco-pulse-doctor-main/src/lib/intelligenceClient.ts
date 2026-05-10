/** Live Monitor intelligence layer client (alerts, timeline, AI). Same-origin. */

export type Alert = {
  alertId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "acknowledged" | "resolved";
  severity: "info" | "warning" | "critical";
  deviceId: string | null;
  deviceName: string | null;
  title: string;
  description: string;
  evidence: Array<Record<string, unknown>>;
  patternIds: string[];
  snapshotId: string | null;
  timelineEventIds: string[];
  deterministicCause: string | null;
  recommendedNextCheck: string | null;
  source: string;
  dedupeKey?: string;
};

export type TimelineEvent = {
  eventId: string;
  createdAt: string;
  source: string;
  deviceId: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  description?: string | null;
  alertId?: string | null;
  snapshotId?: string | null;
};

export type RootCauseAssist = {
  ok?: boolean;
  response: {
    plainEnglishRootCause: string;
    whyThisLooksLikely: string;
    evidenceThatSupportsIt: unknown[];
    evidenceThatContradictsIt: unknown[];
    whatIsStillUnknown: unknown[];
    recommendedNextChecks: string[];
    customerSafeSummary: string;
    internalTechnicalSummary: string;
    escalationDraft: string;
    confidenceWarning: string | null;
    safetyDisclaimer: string;
  };
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  return (await r.json()) as T;
}

export const intelligenceApi = {
  listAlerts: (params: { status?: string; deviceId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.deviceId) q.set("deviceId", params.deviceId);
    return jsonFetch<{ ok: boolean; alerts: Alert[] }>(`/api/alerts${q.toString() ? "?" + q.toString() : ""}`);
  },
  ackAlert: (id: string) =>
    jsonFetch<{ ok: boolean; alert?: Alert }>(`/api/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }),
  resolveAlert: (id: string) =>
    jsonFetch<{ ok: boolean; alert?: Alert }>(`/api/alerts/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
  listTimeline: (params: { deviceId?: string; severity?: string; source?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.deviceId) q.set("deviceId", params.deviceId);
    if (params.severity) q.set("severity", params.severity);
    if (params.source) q.set("source", params.source);
    if (params.limit) q.set("limit", String(params.limit));
    return jsonFetch<{ ok: boolean; events: TimelineEvent[] }>(`/api/timeline${q.toString() ? "?" + q.toString() : ""}`);
  },
  correlateRecent: (deviceId: string, body: { path?: string; lines?: number; sshPassword?: string }) =>
    jsonFetch<{ ok: boolean; correlation?: { correlatedEvents: unknown[]; suspectedPatterns: string[] }; alertsCreated?: number; logs?: unknown }>(
      `/api/monitor/devices/${encodeURIComponent(deviceId)}/correlate-recent`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) },
    ),
  rootCauseAssist: (body: Record<string, unknown>) =>
    jsonFetch<RootCauseAssist>(`/api/ai/root-cause-assist`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
};

export const ALERTS_UPDATED_EVENT = "alerts:updated";
export const TIMELINE_UPDATED_EVENT = "timeline:updated";