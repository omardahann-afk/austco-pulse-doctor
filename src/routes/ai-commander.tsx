import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain, Sparkles, ShieldAlert, ClipboardCopy, RefreshCw, Loader2,
  CircleCheck, CircleX, AlertTriangle, MessageSquare, Search, FileText,
  Wrench, Activity, Microscope,
} from "lucide-react";
import {
  aiCommanderHealth, aiCommanderRun,
  evidenceLatest, autopilotListPlans,
  type CommanderMode, type CommanderResponse, type CommanderResult,
  type CommanderContext, type DeepEvidence, type AutopilotPlan,
} from "@/lib/agentClient";
import { readHandoff, clearHandoff, type CommanderHandoff } from "@/lib/aiCommanderHandoff";

export const Route = createFileRoute("/ai-commander")({
  head: () => ({
    meta: [
      { title: "AI Evidence Commander — Tacera Doctor" },
      { name: "description", content: "A senior-engineer AI brain that explains, challenges, and summarizes deterministic evidence — never executes." },
      { property: "og:title", content: "AI Evidence Commander — Tacera Doctor" },
      { property: "og:description", content: "Explain, challenge, defend, and summarize. AI reads sanitized snapshots only — the deterministic engine controls every decision." },
    ],
  }),
  component: CommanderPage,
});

/* ===================== Modes ===================== */

type ModeDef = {
  id: CommanderMode;
  label: string;
  short: string;
  blurb: string;
  Icon: typeof Sparkles;
};

const MODES: ModeDef[] = [
  { id: "explain_on_site", label: "Explain Like I'm On Site", short: "Explain", blurb: "Plain English for a field tech.", Icon: MessageSquare },
  { id: "evidence_challenge", label: "Evidence Challenge", short: "Challenge", blurb: "What's missing, misleading, or assumed.", Icon: Search },
  { id: "root_cause_defender", label: "Root Cause Defender", short: "Defend", blurb: "Why this cause was chosen over others.", Icon: ShieldAlert },
  { id: "fix_plan_explainer", label: "Fix Plan Explainer", short: "Fix Plan", blurb: "What will happen if approved.", Icon: Wrench },
  { id: "post_fix_analyst", label: "Post-Fix Analyst", short: "Post-Fix", blurb: "Did the fix actually work?", Icon: Activity },
  { id: "escalation_writer", label: "Escalation Writer", short: "Escalate", blurb: "Customer-safe + internal + dev summaries.", Icon: FileText },
];

/* ===================== Helpers ===================== */

function emptyResponse(mode: CommanderMode): CommanderResponse {
  return {
    mode,
    executiveSummary: "",
    technicianExplanation: "",
    evidenceThatMatters: [],
    contradictions: [],
    ruledOutCauses: [],
    riskExplanation: "",
    recommendedNextStep: "",
    customerSafeSummary: "",
    internalTechnicalSummary: "",
    developerDebugSummary: "",
    confidenceWarning: "",
    safetyWarning: "",
  };
}

function copy(text: string, onDone: (msg: string) => void, label = "Copied to clipboard.") {
  if (!text) { onDone("Nothing to copy."); return; }
  try {
    navigator.clipboard.writeText(text).then(() => onDone(label), () => onDone("Copy failed."));
  } catch { onDone("Copy failed."); }
}

/** Pull a default context from latest evidence + most recent plan. */
async function loadDefaultContext(): Promise<CommanderContext> {
  const ctx: CommanderContext = {};
  try {
    const ev = await evidenceLatest();
    if ("ok" in ev && ev.ok) {
      const e: DeepEvidence = ev.evidence;
      ctx.deepEvidence = {
        collectedAt: e.collectedAt,
        mock: !!e.mock,
        mockTag: e.mockTag,
        network: { summary: `Targets: ${e.networkTruth?.targets?.length ?? 0}` },
        process: { summary: `Services observed: ${e.processTruth?.services?.length ?? 0}` },
        port: { summary: `Ports checked: ${e.portTruth?.services?.length ?? 0}` },
        mqtt: e.mqttTruth?.available
          ? { summary: `MQTT events: ${e.mqttTruth.eventCount ?? 0}` }
          : { summary: e.mqttTruth?.message || "MQTT not tapped" },
        config: { summary: `Config issues: ${e.configTruth?.issues?.length ?? 0}` },
        contradictions: Array.isArray(e.contradictions) ? e.contradictions : [],
      };
      ctx.contradictions = Array.isArray(e.contradictions)
        ? e.contradictions.map((c) => ({ kind: c.kind, why: c.why, likelyLayer: c.likelyLayer }))
        : [];
    }
  } catch { /* non-blocking */ }

  try {
    const plans = await autopilotListPlans(1);
    if ("ok" in plans && plans.ok && plans.plans.length > 0) {
      const p: AutopilotPlan = plans.plans[0];
      ctx.plan = p;
      ctx.rootCause = {
        primaryCause: p.rootCause,
        confidence: p.confidence,
        affectedServices: [p.serviceName].filter(Boolean),
        affectedHosts: [p.host].filter(Boolean),
      };
      ctx.affectedServices = [p.serviceName].filter(Boolean);
      ctx.affectedHosts = [p.host].filter(Boolean);
    }
  } catch { /* non-blocking */ }

  return ctx;
}

/* ===================== Page ===================== */

function CommanderPage() {
  const [handoff, setHandoff] = useState<CommanderHandoff | null>(null);
  const [mode, setMode] = useState<CommanderMode>("explain_on_site");
  const [context, setContext] = useState<CommanderContext>({});
  const [contextLoaded, setContextLoaded] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<"unknown" | "yes" | "no">("unknown");
  const [aiReason, setAiReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommanderResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Pick up handoff from the page that triggered us
  useEffect(() => {
    const h = readHandoff();
    if (h) {
      setHandoff(h);
      setMode(h.mode);
      setContext(h.context || {});
      setContextLoaded(true);
      clearHandoff();
    } else {
      // Otherwise load latest deterministic snapshot.
      loadDefaultContext().then((c) => {
        setContext(c);
        setContextLoaded(true);
      });
    }
  }, []);

  // Health probe
  useEffect(() => {
    let alive = true;
    aiCommanderHealth().then((h) => {
      if (!alive) return;
      if ("ok" in h && h.ok) {
        setAiAvailable(h.available ? "yes" : "no");
        setAiReason(h.reason || null);
      } else {
        setAiAvailable("no");
        setAiReason("error" in h ? h.error : "unreachable");
      }
    });
    return () => { alive = false; };
  }, []);

  // Auto-toast clear
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const hasContext = useMemo(() => {
    return !!(context.rootCause || context.trace || context.deepEvidence ||
      context.plan || context.execution || (context.contradictions && context.contradictions.length));
  }, [context]);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const r = await aiCommanderRun({ mode, context });
      setResult(r);
    } finally { setLoading(false); }
  }

  const response: CommanderResponse | null = result?.response ?? null;
  const isFallback = !!(result && !result.ok);

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-info to-insight text-info-foreground">
              <Brain className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold leading-tight">AI Evidence Commander</h1>
              <p className="text-xs text-muted-foreground">A senior-engineer brain that explains, challenges, and summarizes. The deterministic engine still controls every decision.</p>
            </div>
            <StatusBadge available={aiAvailable} fallback={isFallback} />
          </div>

          {handoff && (
            <div className="rounded-md border border-info/40 bg-info/5 px-3 py-2 text-xs text-info-foreground">
              <span className="font-medium">Opened from {handoff.source}</span>
              <span className="text-muted-foreground"> — pre-filled with context from that page.</span>
            </div>
          )}

          {aiAvailable === "no" && (
            <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> AI Commander unavailable.</div>
              <div className="mt-0.5 text-muted-foreground">Deterministic engine still active. Reason: {aiReason || "unknown"}. You can still try — fallback mode will show.</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mode selector */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mode</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors " +
                    (active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/40")
                  }
                >
                  <m.Icon className={"mt-0.5 h-4 w-4 shrink-0 " + (active ? "text-primary" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight">{m.label}</div>
                    <div className="text-[11px] text-muted-foreground">{m.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={run} disabled={loading || !contextLoaded || !hasContext}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Thinking…</> : <><Sparkles className="mr-2 h-4 w-4" /> Run {MODES.find((m) => m.id === mode)?.short}</>}
            </Button>
            {result && (
              <Button variant="outline" onClick={run} disabled={loading}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            )}
            <Link to="/evidence" className="text-xs text-info underline-offset-2 hover:underline">Open Deep Evidence</Link>
            <Link to="/autopilot" className="text-xs text-info underline-offset-2 hover:underline">Open Autopilot</Link>
          </div>

          {!hasContext && contextLoaded && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              No deterministic evidence available yet. Run a diagnosis or collect Deep Evidence first, then return here.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Context summary */}
      <Card>
        <CardContent className="space-y-2 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context being sent (sanitized)</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3 lg:grid-cols-5">
            <ContextChip label="Root Cause" present={!!context.rootCause} />
            <ContextChip label="Trace" present={!!context.trace} />
            <ContextChip label="Deep Evidence" present={!!context.deepEvidence} />
            <ContextChip label="Plan" present={!!context.plan} />
            <ContextChip label="Execution" present={!!context.execution} />
          </div>
          <p className="text-[11px] text-muted-foreground">No passwords, tokens, SSH keys, or raw credentials are ever sent to AI.</p>
        </CardContent>
      </Card>

      {/* Response */}
      {response && (
        <ResponseView
          response={response}
          isFallback={isFallback}
          fallbackReason={result?.ok === false ? result.reason : undefined}
          fallbackMessage={result?.ok === false ? result.message : undefined}
          onCopy={(text, label) => copy(text, (m) => setToast(m), label)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ===================== Subcomponents ===================== */

function StatusBadge({ available, fallback }: { available: "unknown" | "yes" | "no"; fallback: boolean }) {
  if (fallback) return <Badge variant="outline" className="border-warn/60 text-warn-foreground"><AlertTriangle className="mr-1 h-3 w-3" />Fallback Active</Badge>;
  if (available === "yes") return <Badge variant="outline" className="border-success/60 text-success-foreground"><CircleCheck className="mr-1 h-3 w-3" />AI Available</Badge>;
  if (available === "no") return <Badge variant="outline" className="border-destructive/50 text-destructive-foreground"><CircleX className="mr-1 h-3 w-3" />AI Unavailable</Badge>;
  return <Badge variant="outline">Checking…</Badge>;
}

function ContextChip({ label, present }: { label: string; present: boolean }) {
  return (
    <div className={"flex items-center gap-1.5 rounded-md border px-2 py-1 " + (present ? "border-success/40 bg-success/5" : "border-border bg-muted/20 text-muted-foreground")}>
      {present ? <CircleCheck className="h-3 w-3 text-success-foreground" /> : <CircleX className="h-3 w-3" />}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {action}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function CopyBtn({ text, label = "Copy", onCopy }: { text: string; label?: string; onCopy: (t: string, l: string) => void }) {
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onCopy(text, `${label} copied.`)}>
      <ClipboardCopy className="mr-1 h-3 w-3" /> {label}
    </Button>
  );
}

function ResponseView({
  response, isFallback, fallbackReason, fallbackMessage, onCopy,
}: {
  response: CommanderResponse;
  isFallback: boolean;
  fallbackReason?: string;
  fallbackMessage?: string;
  onCopy: (text: string, label: string) => void;
}) {
  const r = response;
  const list = (items: string[], emptyText = "—") =>
    items.length === 0
      ? <p className="text-sm text-muted-foreground">{emptyText}</p>
      : <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        {/* Disclaimer */}
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          AI explanation only. Deterministic engine controls root cause, risk, approval, and execution.
        </div>

        {/* Warnings (always shown if present) */}
        {(r.confidenceWarning || r.safetyWarning) && (
          <div className="space-y-1.5">
            {r.safetyWarning && (
              <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5" />
                <span>{r.safetyWarning}</span>
              </div>
            )}
            {r.confidenceWarning && (
              <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                <span>{r.confidenceWarning}</span>
              </div>
            )}
          </div>
        )}

        {isFallback && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <div className="font-medium">Fallback response shown.</div>
            <div className="text-muted-foreground">Reason: {fallbackReason || "unknown"}. {fallbackMessage || ""}</div>
          </div>
        )}

        <Section title="Executive Summary"
          action={<CopyBtn text={r.executiveSummary} label="Copy" onCopy={onCopy} />}>
          {r.executiveSummary || <span className="text-muted-foreground">—</span>}
        </Section>

        <Section title="Technician Explanation"
          action={<CopyBtn text={r.technicianExplanation} label="Copy" onCopy={onCopy} />}>
          {r.technicianExplanation || <span className="text-muted-foreground">—</span>}
        </Section>

        <Section title="Evidence That Matters">
          {list(r.evidenceThatMatters, "No specific evidence flagged.")}
        </Section>

        <Section title="Contradictions">
          {list(r.contradictions, "No contradictions identified.")}
        </Section>

        <Section title="Ruled-Out Causes">
          {list(r.ruledOutCauses, "No alternates explicitly ruled out.")}
        </Section>

        <Section title="Risk Explanation">
          {r.riskExplanation || <span className="text-muted-foreground">—</span>}
        </Section>

        <Section title="Recommended Next Step"
          action={<CopyBtn text={r.recommendedNextStep} label="Copy" onCopy={onCopy} />}>
          {r.recommendedNextStep || <span className="text-muted-foreground">—</span>}
        </Section>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer-safe</div>
              <CopyBtn text={r.customerSafeSummary} label="Copy" onCopy={onCopy} />
            </div>
            <div className="text-sm leading-relaxed">{r.customerSafeSummary || <span className="text-muted-foreground">—</span>}</div>
          </div>
          <div className="space-y-1.5 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal Technical</div>
              <CopyBtn text={r.internalTechnicalSummary} label="Copy" onCopy={onCopy} />
            </div>
            <div className="text-sm leading-relaxed">{r.internalTechnicalSummary || <span className="text-muted-foreground">—</span>}</div>
          </div>
          <div className="space-y-1.5 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Developer / Debug</div>
              <CopyBtn text={r.developerDebugSummary} label="Copy" onCopy={onCopy} />
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{r.developerDebugSummary || <span className="text-muted-foreground">—</span>}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => onCopy(JSON.stringify(r, null, 2), "Full JSON copied.")}>
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Copy full response (JSON)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export icon to silence unused import warning if Microscope ever drops out.
export const _icons = { Microscope };