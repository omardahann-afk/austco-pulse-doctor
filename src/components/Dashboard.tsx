/**
 * Dashboard.tsx v2 — Pulse Doctor Operational Screen
 * Single screen. Tiles per appliance. Click for AI explanation + repair.
 * Groq AI explains in plain English. One approval button per fix.
 */

import { useState, useEffect, useCallback } from "react";

const API = "http://192.168.10.171:3030";
const POLL_MS = 10000;

interface CascadeItem { label: string; confirmed: boolean; }
interface Appliance {
  ip: string; label: string; role: string;
  health: "OK" | "DEGRADED" | "CRITICAL" | "UNKNOWN" | "OFFLINE";
  color: string;
  rootCauseType?: string; rootCauseLabel?: string;
  humanExplanation?: string;
  cascade?: CascadeItem[];
  nextStep?: string; verification?: string;
  eventCounts: { critical: number; high: number; medium: number };
  lastSeen?: number; stale?: boolean; staleNote?: string; cascadeNote?: string;
}
interface RepairStep {
  label: string; cmd?: string; risk: "LOW" | "MEDIUM" | "MANUAL";
  instruction?: string; requiresApproval?: boolean; description?: string;
}
interface RepairPlan { title: string; steps: RepairStep[]; verifyCmd?: string; }

const HEALTH_STYLE: Record<string, { bg: string; border: string; dot: string; badge: string }> = {
  CRITICAL: { bg: "bg-red-950/70",    border: "border-red-500",    dot: "bg-red-500 animate-pulse",    badge: "bg-red-500/20 text-red-300 border-red-500/40" },
  DEGRADED: { bg: "bg-yellow-950/70", border: "border-yellow-500", dot: "bg-yellow-400 animate-pulse", badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" },
  OK:       { bg: "bg-green-950/40",  border: "border-green-600",  dot: "bg-green-500",                badge: "bg-green-500/20 text-green-300 border-green-500/40" },
  UNKNOWN:  { bg: "bg-zinc-900/50",   border: "border-zinc-700",   dot: "bg-zinc-600",                 badge: "bg-zinc-700/30 text-zinc-500 border-zinc-700/40" },
  OFFLINE:  { bg: "bg-zinc-900/30",   border: "border-zinc-800",   dot: "bg-zinc-700",                 badge: "bg-zinc-800/30 text-zinc-600 border-zinc-800/40" },
};

const ROLE_ICON: Record<string, string> = {
  integration_server: "🖥", floor_controller: "🔌", pst2: "📟",
  doctor_vm: "💊", unknown: "❓",
};

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ ip, onClose }: { ip: string; onClose: () => void }) {
  const [appliance, setAppliance] = useState<Appliance | null>(null);
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [stepResults, setStepResults] = useState<Record<number, any>>({});
  const [approving, setApproving] = useState<number | null>(null);
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function load() {
      const [aRes, pRes] = await Promise.all([
        fetch(`${API}/api/appliance/${encodeURIComponent(ip)}`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair`).then(r => r.json()).catch(() => null),
      ]);
      if (aRes?.ok) setAppliance(aRes.appliance);
      if (pRes?.ok && pRes.plan?.steps?.length) setPlan(pRes.plan);
    }
    load();
  }, [ip]);

  // Auto-fetch AI explanation when panel opens for a critical appliance
  useEffect(() => {
    if (!appliance || appliance.health === 'OK' || appliance.health === 'UNKNOWN') return;
    setAiLoading(true);
    fetch(`${API}/api/ai/explain/${encodeURIComponent(ip)}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.explanation) { setAiExplanation(d.explanation); setAiSource(d.source); }
      })
      .catch(() => null)
      .finally(() => setAiLoading(false));
  }, [appliance?.health, ip]);

  async function runStep(i: number, approved = false) {
    setRunningStep(i);
    setApproving(null);
    try {
      const res = await fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair/run-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIndex: i, approved }),
      });
      const data = await res.json();
      setStepResults(prev => ({ ...prev, [i]: data }));
      if (data.blocked && data.reason === 'REQUIRES_APPROVAL') setApproving(i);
    } finally { setRunningStep(null); }
  }

  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(`${API}/api/appliance/${encodeURIComponent(ip)}/repair/verify-auto`, { method: 'POST' });
      setVerifyResult(await res.json());
    } finally { setVerifying(false); }
  }

  if (!appliance) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-2xl p-8 text-white text-sm">Loading...</div>
    </div>
  );

  const s = HEALTH_STYLE[appliance.health] ?? HEALTH_STYLE.UNKNOWN;

  return (
    <div className="fixed inset-0 bg-black/85 flex items-start justify-center z-50 p-4 overflow-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl mt-6 mb-8 shadow-2xl">

        {/* Header */}
        <div className={`flex items-center gap-3 p-5 rounded-t-2xl border-b border-zinc-800 ${s.bg}`}>
          <span className={`h-4 w-4 rounded-full shrink-0 ${s.dot}`} />
          <span className="text-xl">{ROLE_ICON[appliance.role] ?? '❓'}</span>
          <div className="flex-1">
            <div className="font-bold text-white text-lg leading-tight">{appliance.label}</div>
            <div className="font-mono text-xs text-zinc-400">{appliance.ip}</div>
          </div>
          <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded border ${s.badge}`}>
            {appliance.health}
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl leading-none ml-2">×</button>
        </div>

        <div className="p-5 space-y-4">

          {/* AI Explanation */}
          <div className="rounded-xl border border-blue-800/40 bg-blue-950/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-400 text-sm font-bold">🤖 AI Analysis</span>
              {aiSource && <span className="text-[10px] text-zinc-500 font-mono">{aiSource}</span>}
            </div>
            {aiLoading ? (
              <div className="text-zinc-400 text-sm animate-pulse">Analysing with Groq AI...</div>
            ) : aiExplanation ? (
              <div className="text-zinc-200 text-sm whitespace-pre-line leading-relaxed">{aiExplanation}</div>
            ) : (
              <div className="text-zinc-500 text-sm">No AI explanation available.</div>
            )}
          </div>

          {/* Root Cause */}
          {appliance.rootCauseLabel && (
            <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-red-400 mb-1">Root Cause</div>
              <div className="text-white font-semibold">{appliance.rootCauseLabel}</div>
              {appliance.nextStep && (
                <div className="mt-2 text-sm text-zinc-300">{appliance.nextStep}</div>
              )}
            </div>
          )}

          {/* Cascade */}
          {appliance.cascade && appliance.cascade.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Failure Cascade</div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {appliance.cascade.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-zinc-600">→</span>}
                    <span className={c.confirmed ? "text-red-300" : "text-zinc-600"}>{c.label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Repair Steps */}
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
                      needsApproval ? "border-amber-500/50 bg-amber-950/20" :
                      "border-zinc-700/50 bg-zinc-800/30"
                    }`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          step.risk === "LOW" ? "border-green-700 text-green-400 bg-green-950/30" :
                          step.risk === "MEDIUM" ? "border-amber-700 text-amber-400 bg-amber-950/30" :
                          "border-zinc-600 text-zinc-400 bg-zinc-800/30"
                        }`}>{step.risk}</span>
                        <span className="text-sm text-zinc-200 flex-1">{step.label}</span>

                        {step.risk === 'MANUAL' ? (
                          <button onClick={() => setStepResults(p => ({ ...p, [i]: { manual: true } }))}
                            className="text-[11px] border border-zinc-600 text-zinc-400 rounded px-2 py-0.5 hover:border-zinc-400">
                            Show steps
                          </button>
                        ) : needsApproval ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => setApproving(null)}
                              className="text-[11px] border border-zinc-600 text-zinc-400 rounded px-2 py-0.5">Cancel</button>
                            <button onClick={() => runStep(i, true)}
                              className="text-[11px] bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-0.5 font-bold">
                              ✓ Approve & Run
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => runStep(i)} disabled={isRunning}
                            className={`text-[11px] rounded px-2 py-0.5 border disabled:opacity-40 ${
                              step.risk === "LOW"
                                ? "border-blue-700 text-blue-300 hover:bg-blue-900/30"
                                : "border-amber-700 text-amber-300 hover:bg-amber-900/30"
                            }`}>
                            {isRunning ? "Running…" : step.risk === "MEDIUM" ? "Preview" : "Run"}
                          </button>
                        )}
                      </div>

                      {needsApproval && (
                        <div className="mt-2 text-xs text-amber-300 bg-amber-950/30 rounded p-2">
                          ⚠️ This action modifies the running system: {step.description || step.label}
                        </div>
                      )}
                      {result?.manual && step.instruction && (
                        <pre className="mt-2 text-xs text-zinc-300 bg-zinc-900/80 rounded p-2 whitespace-pre-wrap">{step.instruction}</pre>
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

          {/* Verify Fix */}
          {plan?.verifyCmd && (
            <div>
              <button onClick={verify} disabled={verifying}
                className="w-full rounded-xl border border-emerald-700 bg-emerald-950/30 text-emerald-300 py-3 font-semibold hover:bg-emerald-900/40 transition-colors disabled:opacity-50">
                {verifying ? "Verifying…" : "✓ Verify Fix"}
              </button>
              {verifyResult && (
                <div className={`mt-2 rounded-lg p-3 text-sm font-semibold text-center border ${
                  verifyResult.verified
                    ? "bg-green-950/50 text-green-300 border-green-800"
                    : "bg-red-950/50 text-red-300 border-red-800"
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

// ─── Appliance Tile ───────────────────────────────────────────────────────────

function ApplianceTile({ a, onClick }: { a: Appliance; onClick: () => void }) {
  const s = HEALTH_STYLE[a.health] ?? HEALTH_STYLE.UNKNOWN;
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`h-3 w-3 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-lg">{ROLE_ICON[a.role] ?? '❓'}</span>
        <span className="font-bold text-white text-sm flex-1">{a.label}</span>
        <span className="font-mono text-[11px] text-zinc-500">{a.ip}</span>
      </div>

      <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${
        a.health === 'CRITICAL' ? 'text-red-400' :
        a.health === 'DEGRADED' ? 'text-yellow-400' :
        a.health === 'OK' ? 'text-green-400' : 'text-zinc-500'
      }`}>
        {a.health}
        {a.stale && <span className="ml-2 normal-case font-normal text-zinc-600">{a.staleNote}</span>}
      </div>

      {a.rootCauseLabel && a.health !== 'OK' && a.health !== 'UNKNOWN' && (
        <div className="text-xs text-zinc-300 mt-1 line-clamp-2">{a.rootCauseLabel}</div>
      )}
      {(a.health === 'OK') && (
        <div className="text-xs text-green-600 mt-1">All systems healthy</div>
      )}
      {a.health === 'UNKNOWN' && (
        <div className="text-xs text-zinc-600 mt-1">No agent report received</div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {a.eventCounts.critical > 0 && (
          <span className="text-[10px] bg-red-900/50 text-red-300 border border-red-800/50 rounded px-1.5 py-0.5">
            {a.eventCounts.critical} critical
          </span>
        )}
        {a.eventCounts.high > 0 && (
          <span className="text-[10px] bg-yellow-900/50 text-yellow-300 border border-yellow-800/50 rounded px-1.5 py-0.5">
            {a.eventCounts.high} high
          </span>
        )}
        {a.cascadeNote && (
          <span className="text-[10px] text-orange-400">⚡ {a.cascadeNote}</span>
        )}
      </div>
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  const criticals = data?.appliances?.filter((a: Appliance) => a.health === 'CRITICAL').length ?? 0;
  const degraded  = data?.appliances?.filter((a: Appliance) => a.health === 'DEGRADED').length ?? 0;
  const ok        = data?.appliances?.filter((a: Appliance) => a.health === 'OK').length ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">💊</span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight leading-none">Pulse Doctor</h1>
              <div className="text-xs text-zinc-500 mt-0.5">Austco · Tacera · Field Diagnostic Copilot</div>
            </div>
            <span className="text-xs bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5 font-mono">v2.0</span>
          </div>
        </div>

        <div className="text-right">
          {data ? (
            <div>
              <div className={`text-xl font-bold ${
                criticals > 0 ? 'text-red-400' : degraded > 0 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {data.systemHealth}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {criticals > 0 && <span className="text-red-400">{criticals} critical · </span>}
                {degraded > 0 && <span className="text-yellow-400">{degraded} degraded · </span>}
                {ok > 0 && <span className="text-green-500">{ok} ok · </span>}
                {data.totalAppliances} appliances
              </div>
              <div className="text-[10px] text-zinc-600 mt-0.5">Updated {lastUpdated}</div>
            </div>
          ) : error ? (
            <div className="text-red-400 text-sm">Backend unreachable</div>
          ) : (
            <div className="text-zinc-500 text-sm animate-pulse">Connecting…</div>
          )}
        </div>
      </div>

      {/* Critical banner */}
      {criticals > 0 && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-3 flex items-center gap-3">
          <span className="text-red-400 text-lg">🚨</span>
          <div>
            <div className="text-red-300 font-semibold text-sm">
              {criticals} critical issue{criticals > 1 ? 's' : ''} detected
            </div>
            <div className="text-red-400/70 text-xs">Click a red tile to see root cause and fix options</div>
          </div>
        </div>
      )}

      {/* Appliance grid */}
      {data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.appliances.map((a: Appliance) => (
            <ApplianceTile key={a.ip} a={a} onClick={() => setSelected(a.ip)} />
          ))}
        </div>
      ) : !error ? (
        <div className="flex items-center justify-center h-64 text-zinc-600 animate-pulse">
          Connecting to backend…
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="text-red-500 text-lg">⚠ Backend unreachable</div>
          <div className="text-zinc-500 text-sm">Is server.js running on 192.168.10.171:3030?</div>
          <button onClick={poll} className="text-xs border border-zinc-700 text-zinc-400 rounded px-3 py-1.5 hover:border-zinc-500">
            Retry
          </button>
        </div>
      )}

      {/* Detail panel */}
      {selected && <DetailPanel ip={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
