/** Autopilot recommendations client. Same-origin proxy. */

export type RecommendationAction = { id: string; label: string; command?: string; reason?: string };

export type AutopilotRecommendation = {
  recommendationId: string;
  createdAt: string;
  alertId: string;
  deviceId: string | null;
  deviceName: string | null;
  deviceKind: string | null;
  title: string;
  summary: string;
  matchedReason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "MANUAL";
  allowedActions: RecommendationAction[];
  blockedActions: RecommendationAction[];
  verificationSteps: string[];
  rollbackNotes: string[];
  requiresApproval: boolean;
  aiCanExplain: boolean;
  status: "pending" | "approved" | "rejected";
  decidedBy: string;
  relatedSnapshotId: string | null;
  relatedTimelineEventIds: string[];
  deterministicCause: string | null;
  recommendedNextCheck: string | null;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  return (await r.json()) as T;
}

export const RECOMMENDATIONS_UPDATED_EVENT = "autopilot-recs:updated";
export const PENDING_ALERT_FOR_AUTOPILOT_KEY = "autopilot:pendingAlertId";

export const recommendationsApi = {
  list: () => j<{ ok: boolean; recommendations: AutopilotRecommendation[] }>("/api/autopilot/recommendations"),
  get: (id: string) => j<{ ok: boolean; recommendation?: AutopilotRecommendation }>(`/api/autopilot/recommendations/${encodeURIComponent(id)}`),
  fromAlert: (alertId: string) => j<{ ok: boolean; recommendation?: AutopilotRecommendation; reason?: string }>(
    `/api/autopilot/recommendations/from-alert/${encodeURIComponent(alertId)}`,
    { method: "POST" },
  ),
  approve: (id: string) => j<{ ok: boolean; recommendation?: AutopilotRecommendation }>(
    `/api/autopilot/recommendations/${encodeURIComponent(id)}/approve`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  ),
  reject: (id: string, reason?: string) => j<{ ok: boolean; recommendation?: AutopilotRecommendation }>(
    `/api/autopilot/recommendations/${encodeURIComponent(id)}/reject`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) },
  ),
};