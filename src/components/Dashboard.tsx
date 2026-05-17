/**
 * Dashboard.tsx — Pulse Doctor Operational Screen
 * Single screen. Tiles per appliance. Click for detail + repair.
 */

import { useState, useEffect, useCallback } from "react";

const API = "http://192.168.10.171:3030";
const POLL_MS = 5000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Appliance {
  ip: string;
  label: string;
  role: string;
  health: "OK" | "DEGRADED" | "CRITICAL" | "UNKNOWN" | "OFFLINE";
  color: "green" | "yellow" | "red" | "gray";
  rootCauseLabel?: string;
  humanExplanation?: string;
  cascade?: { label: string; confirmed: boolean }[];
  nextStep?: string;
  verification?: string;
  eventCounts: { critical: number; high: number; medium: number };
  lastSeen?: number;
  stale?: boolean;
  staleNote?: string;
  cascadeNote?: string;
  topEvents?: any[];
}

interface Dashboard {
  systemHealth: string;
  criticalCount: number;
  degradedCount: number;
  totalAppliances: number;
  appliances: Appliance[];
  updatedAt: string;
}

interface RepairStep {
  label: string;
  cmd?: string;
  risk: "LOW" | "MEDIUM" | "MANUAL";
  instruction?: string;
  requiresApproval?: boolean;
}

interface RepairPlan {
  title: string;
  steps: RepairStep[];
  verifyCmd?: string;
}

// ─── Color config ─────────────────────────────────────────────────────────────

const HEALTH_STYLE: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  CRITICAL: { bg: "bg-red-950/60",    border: "border-red-500",    dot: "bg-red-500 animate-pulse", label: "text-red-400" },
  DEGRADED: { bg: "bg-yellow-950/60", border: "border-yellow-500", dot: "bg-yellow-400 animate-pulse", label: "text-yellow-400" },
  OK:       { bg: "bg-green-950/40",  border: "border-green-600",  dot: "bg-green-500", label: "text-green-400" },
  UNKNOWN:  { bg: "bg-zinc-900/60",   border: "border-zinc-700",   dot: "bg-zinc-600", label: "text-zinc-500" },
  OFFLINE:  { bg: "bg-zinc-900/40",   border: "border-zinc-800",   dot: "bg-zinc-700", label: "text-zinc-600" },
};

const ROLE_ICON: Record<string, string> = {
  integration_server: "🖥",
  pst2: "📟",
  floor_controller: "🔌",
  doctor_vm: "💊",
  unknown: "❓",
};

// ─── Appliance Tile ───────────────────────────────────────────────────────────

function ApplianceTile({ a, onClick }: { a: Appliance; onClick: () => void }) {
  const s = HEALTH_STYLE[a.health] ?? HEALTH_STYLE.UNKNOWN;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:scale-[1.02] hover:shadow-lg ${s.bg} ${s.border}`}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className={`h-3 w-3 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-lg">{ROLE_ICON[a.role] ?? "❓"}</span>
        <span className="font-bold text-white text-sm">{a.label}</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">{a.ip}</span>
      </div>

      <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${s.label}`}>
        {a.health}
        {a.stale && <span className="ml-2 text-zinc-500 normal-case font-normal">{a.staleNote}</span>}
      </div>

      {a.rootCauseLabel && a.health !== "OK" && a.health !== "UNKNOWN" && (
        <div className="text-xs text-zinc-300 mt-1 line-clamp-2">{a.rootCauseLabel}</div>
      )}

      {a.health === "UNKNOWN" && (
        <div className="text-xs text-zinc-600 mt-1">No agent report received</div>
      )}

      {(a.eventCounts.critical > 0 || a.eventCounts.high > 0) && (
        <div className="flex gap-2 mt-2">
          {a.eventCounts.critical > 0 && (
            <span className="text-[10px] bg-red-900/60 text-red-300 rounded px-1.5 py-0.5">
              {a.eventCounts.critical} critical
            </span>
          )}
          {a.eventCounts.high > 0 && (
            <span className="text-[10px] bg-yellow-900/60 text-yellow-300 rounded px-1.5 py-0.5">
              {a.eventCounts.high} high
            </span>
          )}
        </div>
      )}

      {a.cascadeNote && (
        <div className="text-[10px] text-orange-400 mt-1.5">⚡ {a.cascadeNote}</div>
      )}
    </button>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ ip, onClose }: { ip: string; onClose: () => void }) {
  const [appliance, setAppliance] = useState<Appliance | null>(null);
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [stepResults, setStepResults] = useState<Record<number, any>>({});
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [approving, setApproving] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const [aRes, pRes] = await Promise.all([
        fetch(`${API}/api/appliance/${encodeURIComponent(ip)}`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair`).then(r => r.json()).catch(() => null),
      ]);
      if (aRes?.ok) setAppliance(aRes.appliance);
      if (pRes?.ok) setPlan(pRes.plan);
    }
    load();
  }, [ip]);

  async function runStep(i: number, approved = false) {
    setRunningStep(i);
    setApproving(null);
    try {
      const res = await fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex: i, approved, sshCreds: { host: ip, username: "tech" } }),
      });
      const data = await res.json();
      setStepResults(prev => ({ ...prev, [i]: data }));
      if (data.blocked && data.reason === "REQUIRES_APPROVAL") setApproving(i);
    } finally {
      setRunningStep(null);
    }
  }

  async function verify() {
    const res = await fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sshCreds: { host: ip, username: "tech" } }),
    });
    const data = await res.json();
    setVerifyResult(data);
  }

  if (!appliance) return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-2xl p-8 text-white">Loading...</div>
    </div>
  );

  const s = HEALTH_STYLE[appliance.health] ?? HEALTH_STYLE.UNKNOWN;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start justify-center z-50 p-4 overflow-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl mt-8 mb-8">
        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b border-zinc-800 rounded-t-2xl ${s.bg}`}>
          <span className={`h-4 w-4 rounded-full ${s.dot}`} />
          <span className="text-xl">{ROLE_ICON[appliance.role]}</span>
          <div>
            <div className="font-bold text-white text-lg">{appliance.label}</div>
            <div className="font-mono text-xs text-zinc-400">{appliance.ip}</div>
          </div>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">

          {/* Root cause */}
          {appliance.rootCauseLabel && (
            <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-red-400 mb-1">Root Cause</div>
              <div className="text-white font-semibold">{appliance.rootCauseLabel}</div>
              {appliance.humanExplanation && (
                <div className="text-zinc-300 text-sm mt-2">{appliance.humanExplanation}</div>
              )}
            </div>
          )}

          {/* Cascade */}
          {appliance.cascade && appliance.cascade.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Failure Cascade</div>
              <div className="space-y-1">
                {appliance.cascade.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${c.confirmed ? "bg-red-500" : "bg-zinc-600"}`} />
                    <span className={c.confirmed ? "text-zinc-200" : "text-zinc-500"}>{c.label}</span>
                    {!c.confirmed && <span className="text-[10px] text-zinc-600">(not confirmed)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next step */}
          {appliance.nextStep && (
            <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">Exact Next Step</div>
              <div className="text-white text-sm">{appliance.nextStep}</div>
            </div>
          )}

          {/* Repair plan */}
          {plan && plan.steps.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">{plan.title}</div>
              <div className="space-y-2">
                {plan.steps.map((step, i) => {
                  const result = stepResults[i];
                  const isRunning = runningStep === i;
                  const needsApproval = approving === i;

                  return (
                    <div key={i} className={`rounded-lg border p-3 ${
                      result?.ok === true ? "border-green-800/50 bg-green-950/20" :
                      result?.ok === false && !result?.blocked ? "border-red-800/50 bg-red-950/20" :
                      "border-zinc-700/50 bg-zinc-800/30"
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          step.risk === "LOW"    ? "border-green-700 text-green-400 bg-green-950/30" :
                          step.risk === "MEDIUM" ? "border-yellow-700 text-yellow-400 bg-yellow-950/30" :
                                                   "border-zinc-600 text-zinc-400 bg-zinc-800/30"
                        }`}>{step.risk}</span>
                        <span className="text-sm text-zinc-200 flex-1">{step.label}</span>

                        {step.risk === "MANUAL" ? (
                          <button onClick={() => setStepResults(p => ({ ...p, [i]: { manual: true } }))}
                            className="text-[11px] border border-zinc-600 text-zinc-400 rounded px-2 py-0.5 hover:border-zinc-400">
                            Show instructions
                          </button>
                        ) : needsApproval ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => setStepResults(p => ({ ...p, [i]: null })) || setApproving(null)}
                              className="text-[11px] border border-zinc-600 text-zinc-400 rounded px-2 py-0.5">Cancel</button>
                            <button onClick={() => runStep(i, true)}
                              className="text-[11px] bg-yellow-600 hover:bg-yellow-500 text-black rounded px-2 py-0.5 font-bold">
                              ✓ Allow & Run
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => runStep(i)} disabled={isRunning}
                            className={`text-[11px] rounded px-2 py-0.5 border ${
                              step.risk === "LOW"
                                ? "border-blue-700 text-blue-300 hover:bg-blue-900/30"
                                : "border-yellow-700 text-yellow-300 hover:bg-yellow-900/30"
                            } disabled:opacity-40`}>
                            {isRunning ? "Running…" : "Run"}
                          </button>
                        )}
                      </div>

                      {/* Result output */}
                      {result?.manual && step.instruction && (
                        <pre className="mt-2 text-xs text-zinc-300 bg-zinc-900 rounded p-2 whitespace-pre-wrap">{step.instruction}</pre>
                      )}
                      {result?.blocked && result?.reason === "REQUIRES_APPROVAL" && !needsApproval && (
                        <div className="mt-2 text-xs text-yellow-400">Click Allow & Run to confirm this action modifies the system.</div>
                      )}
                      {result?.blocked && result?.reason === "MANUAL_STEP" && (
                        <pre className="mt-2 text-xs text-zinc-300 bg-zinc-900 rounded p-2 whitespace-pre-wrap">{result.instruction}</pre>
                      )}
                      {result?.stdout && (
                        <pre className="mt-2 text-xs text-zinc-300 bg-black/50 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.stdout}</pre>
                      )}
                      {result?.stderr && (
                        <pre className="mt-2 text-xs text-red-400 bg-red-950/30 rounded p-2 overflow-auto max-h-20 whitespace-pre-wrap">{result.stderr}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Verify */}
          {plan?.verifyCmd && (
            <div>
              <button onClick={verify}
                className="w-full rounded-xl border border-emerald-700 bg-emerald-950/30 text-emerald-300 py-3 font-semibold hover:bg-emerald-900/40 transition-colors">
                ✓ Verify Fix
              </button>
              {verifyResult && (
                <div className={`mt-2 rounded-lg p-3 text-sm font-semibold text-center ${
                  verifyResult.verified ? "bg-green-950/50 text-green-300 border border-green-800" : "bg-red-950/50 text-red-300 border border-red-800"
                }`}>
                  {verifyResult.message}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  const systemColor = data?.systemHealth === "CRITICAL" ? "text-red-400" :
                      data?.systemHealth === "DEGRADED"  ? "text-yellow-400" : "text-green-400";

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">💊</span>
            <h1 className="text-2xl font-bold tracking-tight">Pulse Doctor</h1>
            <span className="text-xs bg-zinc-800 text-zinc-400 rounded px-2 py-0.5 font-mono">v2.0</span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">Austco · Tacera · Field Diagnostic Copilot</div>
        </div>

        <div className="text-right">
          {data ? (
            <>
              <div className={`text-lg font-bold ${systemColor}`}>{data.systemHealth}</div>
              <div className="text-xs text-zinc-500">
                {data.criticalCount > 0 && <span className="text-red-400">{data.criticalCount} critical · </span>}
                {data.degradedCount > 0 && <span className="text-yellow-400">{data.degradedCount} degraded · </span>}
                {data.totalAppliances} appliances
              </div>
              <div className="text-[10px] text-zinc-600 mt-0.5">
                Updated {new Date(data.updatedAt).toLocaleTimeString()}
              </div>
            </>
          ) : error ? (
            <div className="text-red-400 text-sm">Backend unreachable: {error}</div>
          ) : (
            <div className="text-zinc-500 text-sm">Connecting…</div>
          )}
        </div>
      </div>

      {/* Appliance grid */}
      {data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.appliances.map(a => (
            <ApplianceTile key={a.ip} a={a} onClick={() => setSelected(a.ip)} />
          ))}
        </div>
      ) : !error ? (
        <div className="flex items-center justify-center h-64 text-zinc-600">Connecting to backend…</div>
      ) : (
        <div className="flex items-center justify-center h-64 text-red-500">
          Cannot reach backend at {API} — is server.js running on port 3030?
        </div>
      )}

      {/* Detail panel */}
      {selected && <DetailPanel ip={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
