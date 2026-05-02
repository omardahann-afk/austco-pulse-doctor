import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2, XCircle, Loader2, MinusCircle, ChevronRight, ChevronDown,
  Activity, ArrowLeft, Search, Copy, RefreshCw, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDiagnosisRun, deriveFinalResult, rerunLastDiagnosis,
  type DiagnosisRunSnapshot, type FinalResult, type TruthStates,
} from "@/lib/diagnosisRunStore";
import type { ChainStep } from "@/lib/breakpointEngine";
import type { CallPointStep } from "@/lib/callPointTrace";
import type { RcTraceStep } from "@/lib/roomControllerDoctor";

export const Route = createFileRoute("/diagnosis")({
  head: () => ({ meta: [
    { title: "Diagnosis — Tacera Doctor" },
    { name: "description", content: "Where the system broke, why, and how to fix it." },
  ]}),
  component: DiagnosisPage,
});

/* =================================================================== */

function DiagnosisPage() {
  const snap = useDiagnosisRun();
  const final = useMemo(() => deriveFinalResult(snap), [snap]);

  const finalRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [highlightStep, setHighlightStep] = useState<string | null>(null);
  const [highlightProof, setHighlightProof] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const scrolledRef = useRef(false);

  // Auto-scroll to Final Result on first ready state
  useEffect(() => {
    if (snap.state.status !== "ready" || scrolledRef.current) return;
    scrolledRef.current = true;
    setTimeout(() => finalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [snap.state.status]);

  if (snap.state.status === "idle") return <IdleEmpty />;

  const steps = unifySteps(snap);
  const failedStep = steps.find((s) => s.status === "Failed");

  function jumpToFailedStep() {
    if (!failedStep) return;
    const el = stepRefs.current[failedStep.id];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightStep(failedStep.id);
    setTimeout(() => setHighlightStep(null), 1600);
  }
  function jumpToFinal(proofIdx?: number) {
    finalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (proofIdx !== undefined) {
      setHighlightProof(proofIdx);
      setTimeout(() => setHighlightProof(null), 1600);
    }
  }

  async function copySummary() {
    await navigator.clipboard.writeText(buildSummary(final, snap));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  async function rerun() {
    setRerunning(true);
    scrolledRef.current = false;
    await rerunLastDiagnosis();
    setRerunning(false);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-6 md:py-8">
      <RunBar snap={snap} onRerun={rerun} rerunning={rerunning} />

      {/* 1. FINAL RESULT — dominant block */}
      <section ref={finalRef}>
        <FinalResultBlock
          final={final}
          running={snap.state.status === "running"}
          onCopy={copySummary}
          copied={copied}
          onJumpToBreak={jumpToFailedStep}
          highlightProof={highlightProof}
          onRerun={rerun}
          rerunning={rerunning}
        />
      </section>

      {/* 2. TRUTH LINE */}
      <section><TruthLine truth={final.truth} priorityExplanation={final.priorityExplanation} /></section>

      {/* 3. TRACE FLOW */}
      <section ref={traceRef}>
        <SectionTitle n={3} title="Trace Flow" />
        <TraceFlow
          steps={steps}
          stepRefs={stepRefs}
          highlightId={highlightStep}
          onClickFailed={() => jumpToFinal()}
        />
      </section>

      {/* 4. PRIMARY EVIDENCE */}
      <section>
        <SectionTitle n={4} title="Primary Evidence" />
        <PrimaryEvidence final={final} />
      </section>

      {/* 5. FIX ACTIONS */}
      <section>
        <SectionTitle n={5} title="Fix Actions" />
        <FixActions final={final} />
      </section>

      {/* 6. SECONDARY FINDINGS */}
      {final.secondaryFindings.length > 0 && (
        <section>
          <SectionTitle n={6} title="Secondary Findings" />
          <SecondaryFindings final={final} />
        </section>
      )}

      {/* CCP / Network expandables — collapsed by default, no duplication */}
      <section className="space-y-3 pt-2">
        <CollapsiblePanel title="CCP Truth — parsed config & findings" defaultOpen={false}>
          <CcpPanelBody snap={snap} />
        </CollapsiblePanel>
        <CollapsiblePanel title="Network Truth — switches, ports, MAC/ARP" defaultOpen={false}>
          <NetworkPanelBody snap={snap} />
        </CollapsiblePanel>
      </section>
    </div>
  );
}

/* =================================================================== */
/* Idle                                                                */
/* =================================================================== */

function IdleEmpty() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Search className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Run diagnosis to analyze site</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Configure the site on the Command Center and press <span className="font-mono">Run Full Diagnosis</span>.
      </p>
      <Link to="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:bg-info/90">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Command Center
      </Link>
    </div>
  );
}

/* =================================================================== */
/* Run bar                                                             */
/* =================================================================== */

function RunBar({ snap, onRerun, rerunning }: { snap: DiagnosisRunSnapshot; onRerun: () => void; rerunning: boolean }) {
  const { state } = snap;
  const site = state.status === "ready" ? state.site : snap.payload?.name ?? "Site";
  const ts = state.status === "ready" ? `Updated ${timeAgo(state.finishedAt)}`
           : state.status === "running" ? "Running…"
           : "—";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Activity className="h-3.5 w-3.5 text-info" />
      <span className="font-semibold">{site}</span>
      <span className="text-muted-foreground">· {ts}</span>
      <span className="ml-auto flex items-center gap-2">
        <Link to="/" className="text-muted-foreground hover:text-foreground">Edit site</Link>
        <Button size="sm" variant="outline" onClick={onRerun} disabled={rerunning || state.status === "running"} className="h-7">
          {rerunning ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
          Re-run
        </Button>
      </span>
    </div>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  return new Date(iso).toLocaleTimeString();
}

/* =================================================================== */
/* 1. FINAL RESULT — dominant                                          */
/* =================================================================== */

function FinalResultBlock({
  final, running, onCopy, copied, onJumpToBreak, highlightProof, onRerun, rerunning,
}: {
  final: FinalResult; running: boolean; onCopy: () => void; copied: boolean;
  onJumpToBreak: () => void; highlightProof: number | null;
  onRerun: () => void; rerunning: boolean;
}) {
  const ok = final.ok;
  const conf = final.confidence;
  const confLabel = conf >= 95 ? "High" : conf >= 80 ? "Strong" : conf >= 60 ? "Moderate" : "Low";
  const confBlurb =
    conf >= 90 ? "This is confirmed by multiple verified sources."
    : conf >= 80 ? "This is strongly supported by available evidence."
    : conf < 70 ? "Low confidence — verify manually."
    : "Supported by available evidence.";

  return (
    <div
      className={cn(
        "relative rounded-xl border-l-[6px] bg-card p-6 shadow-lg md:p-8",
        ok
          ? "border-l-success bg-gradient-to-br from-success/10 via-card to-card"
          : "border-l-critical bg-gradient-to-br from-critical/15 via-card to-card shadow-[0_0_60px_-25px_var(--critical)]",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle2 className="h-6 w-6 text-success" />
          : <XCircle className="h-6 w-6 text-critical" />}
        <span className={cn(
          "text-[11px] font-bold uppercase tracking-[0.22em]",
          ok ? "text-success" : "text-critical",
        )}>
          {ok ? "System operating normally" : "Break Found"}
        </span>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onCopy} className="h-8">
            <Copy className="mr-1.5 h-3 w-3" />
            {copied ? "Copied" : "Copy summary"}
          </Button>
          <Button size="sm" variant="outline" onClick={onRerun} disabled={rerunning} className="h-8">
            {rerunning ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
            Re-run
          </Button>
        </div>
      </div>

      {/* BREAK FOUND AT — largest text */}
      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Break Found At
        </div>
        <button
          type="button"
          onClick={ok ? undefined : onJumpToBreak}
          className={cn(
            "mt-2 block w-full text-left text-2xl font-extrabold leading-tight tracking-tight md:text-3xl lg:text-4xl",
            ok ? "text-success" : "text-critical hover:underline",
          )}
        >
          {ok ? "No break detected" : final.breakAt}
        </button>
        {final.previousStepPassed && !ok && (
          <div className="mt-2 text-xs text-muted-foreground">
            Last working step: <span className="font-mono text-foreground">{final.previousStepPassed}</span>
          </div>
        )}
      </div>

      {/* PRIMARY CAUSE */}
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Primary Cause
        </div>
        <p className="mt-2 text-base font-medium leading-relaxed md:text-lg">
          {ok ? "End-to-end signal path operational." : decisiveCause(final)}
        </p>
      </div>

      {/* PROOF */}
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Proof
        </div>
        <ul className="mt-3 space-y-2.5 text-sm">
          {(final.evidence.length ? final.evidence.slice(0, 5) : (ok ? defaultPassProofs(final) : ["No raw evidence — finding based on trace data only."])).map((e, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-2 rounded-md px-2 py-1.5 transition-colors",
                highlightProof === i && "bg-warning/20 ring-1 ring-warning/40",
              )}
            >
              <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-critical")} />
              <span className="font-mono text-[13px] leading-relaxed">{e}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* CONFIDENCE */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Confidence
        </div>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold",
          conf >= 90 ? "bg-success/20 text-success"
          : conf >= 80 ? "bg-info/20 text-info"
          : conf >= 60 ? "bg-warning/20 text-warning"
          : "bg-critical/20 text-critical",
        )}>
          {conf}% · {confLabel}
        </span>
        <p className="text-xs text-muted-foreground">{confBlurb}</p>
      </div>

      {final.confidenceReasons.length > 0 && (
        <ul className="mt-3 space-y-1 pl-1 text-xs text-muted-foreground">
          {final.confidenceReasons.map((r, i) => <li key={i}>· {r}</li>)}
        </ul>
      )}

      {/* FIX NOW — boxed */}
      {!ok && final.fix.length > 0 && (
        <div className="mt-7 rounded-lg border border-border/60 bg-background/40 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-info">
            Fix Now
          </div>
          <ol className="mt-3 space-y-3 text-sm">
            {final.fix.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/15 text-xs font-bold text-info">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {conf < 70 && !ok && (
        <div className="mt-4 flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5" />
          Low confidence — verify manually before changing hardware.
        </div>
      )}
    </div>
  );
}

function decisiveCause(final: FinalResult): string {
  // Prefer the engine's "why" but trim hedging words.
  return (final.why || "Failure detected.")
    .replace(/\bpossibl[ey]\b/gi, "")
    .replace(/\blikely\b/gi, "")
    .replace(/\bmay (be|have)\b/gi, "is")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function defaultPassProofs(final: FinalResult): string[] {
  const out: string[] = [];
  if (final.truth.network === "PASS")  out.push("Network: SNMP / ARP / scan returned expected switch and port state");
  if (final.truth.ccp === "PASS")      out.push("CCP: parsed config matches deployed controllers, devices, and rules");
  if (final.truth.behavior === "PASS") out.push("Behavior: real log analysis returned no critical errors");
  if (out.length === 0) out.push("All probed layers responded as expected");
  return out;
}

/* =================================================================== */
/* 2. TRUTH LINE                                                       */
/* =================================================================== */

function TruthLine({ truth, priorityExplanation }: { truth: TruthStates; priorityExplanation: string }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <TruthChip label="Network"  state={truth.network} />
        <TruthChip label="CCP"      state={truth.ccp} />
        <TruthChip label="Behavior" state={truth.behavior} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{priorityExplanation}</p>
    </div>
  );
}

function TruthChip({ label, state }: { label: string; state: string }) {
  // Color map — green PASS, red FAIL, yellow LOW/MOCK, grey otherwise.
  const isPass = state === "PASS";
  const isFail = state === "FAIL" || state === "FAIL_VERIFIED";
  const isWarn = state === "LOW_CONFIDENCE" || state === "MOCK";
  const cls = isPass ? "bg-success/15 text-success border-success/40"
            : isFail ? "bg-critical/15 text-critical border-critical/50"
            : isWarn ? "bg-warning/15 text-warning border-warning/40"
            :          "bg-muted/30 text-muted-foreground border-border";
  const display = state.replace(/_/g, " ");
  return (
    <div className={cn("rounded-md border px-3 py-2", cls)}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">{label}</div>
      <div className="mt-0.5 text-sm font-bold uppercase tracking-wider">{display}</div>
    </div>
  );
}

/* =================================================================== */
/* 3. TRACE FLOW (vertical)                                            */
/* =================================================================== */

type UnifiedStep = {
  id: string; layer: string; label: string; detail: string;
  status: "Pending" | "Running" | "Passed" | "Failed" | "Skipped";
  evidence: string[]; source: string;
};

function unifySteps(snap: DiagnosisRunSnapshot): UnifiedStep[] {
  const base =
    snap.rcSteps.length ? snap.rcSteps.map(toUnified) :
    snap.cpSteps.length ? snap.cpSteps.map(toUnified) :
    snap.chainSteps.map(toUnified);
  if (!snap.ccpStep) return base;
  const ccpUnified = toUnified(snap.ccpStep);
  const insertIdx = (() => {
    const lastRc = [...base].map((s, i) => /room|ipnet|controller/i.test(s.layer) ? i : -1).filter((i) => i >= 0).pop();
    if (lastRc !== undefined) return lastRc + 1;
    return Math.min(2, base.length);
  })();
  return [...base.slice(0, insertIdx), ccpUnified, ...base.slice(insertIdx)];
}
function toUnified(s: RcTraceStep | CallPointStep | ChainStep): UnifiedStep {
  return {
    id: s.id, layer: s.layer, label: s.label, detail: s.detail,
    status: s.status as UnifiedStep["status"],
    evidence: s.evidence ?? [],
    source: (s as ChainStep).source ?? "trace",
  };
}

function TraceFlow({
  steps, stepRefs, highlightId, onClickFailed,
}: {
  steps: UnifiedStep[];
  stepRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  highlightId: string | null;
  onClickFailed: () => void;
}) {
  if (steps.length === 0) {
    return <div className="rounded border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">Trace not started.</div>;
  }
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const failed = s.status === "Failed";
        return (
          <li key={s.id} className="relative">
            <div className="flex items-stretch gap-3">
              {/* Connector + dot */}
              <div className="flex flex-col items-center">
                <span className={cn(
                  "h-3 w-3 shrink-0 rounded-full ring-2 ring-background",
                  s.status === "Passed"  ? "bg-success" :
                  s.status === "Failed"  ? "bg-critical" :
                  s.status === "Running" ? "bg-info" :
                                           "bg-muted-foreground/40",
                )} />
                {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
              </div>
              {/* Step card */}
              <button
                ref={(el) => { stepRefs.current[s.id] = el; }}
                type="button"
                onClick={failed ? onClickFailed : undefined}
                className={cn(
                  "mb-3 w-full rounded-md border bg-card/60 px-4 py-3 text-left transition-all",
                  s.status === "Passed"  && "border-success/40",
                  s.status === "Failed"  && "border-critical/60 shadow-[0_0_24px_-6px_var(--critical)]",
                  s.status === "Running" && "border-info/50",
                  (s.status === "Pending" || s.status === "Skipped") && "border-border/50 opacity-70",
                  highlightId === s.id && "ring-2 ring-warning/70 animate-pulse",
                  failed && "cursor-pointer hover:bg-card",
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={s.status} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{s.layer}</span>
                  <span className={cn(
                    "ml-auto text-[10px] font-bold uppercase tracking-wider",
                    failed ? "text-critical" :
                    s.status === "Passed" ? "text-success" :
                    s.status === "Running" ? "text-info" :
                    "text-muted-foreground",
                  )}>{s.status}</span>
                </div>
                <div className="mt-1 text-sm font-semibold">{s.label}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</div>
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StatusIcon({ status }: { status: UnifiedStep["status"] }) {
  if (status === "Passed")  return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === "Failed")  return <XCircle className="h-3.5 w-3.5 text-critical" />;
  if (status === "Running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />;
  return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}

/* =================================================================== */
/* 4. PRIMARY EVIDENCE                                                 */
/* =================================================================== */

function PrimaryEvidence({ final }: { final: FinalResult }) {
  if (final.configEvidence.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No structured evidence rows — the finding is based on trace data shown above.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border/50">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Field</th>
            <th className="px-3 py-2 text-left">Expected</th>
            <th className="px-3 py-2 text-left">Actual</th>
            <th className="px-3 py-2 text-left">Impact</th>
          </tr>
        </thead>
        <tbody>
          {final.configEvidence.map((e, i) => (
            <tr key={i} className="border-t border-border/40">
              <td className="px-3 py-2 font-mono text-[11px]">{e.source}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{e.field}</td>
              <td className="px-3 py-2">{e.expected}</td>
              <td className="px-3 py-2 text-critical">{e.actual}</td>
              <td className="px-3 py-2 text-muted-foreground">{e.impact}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =================================================================== */
/* 5. FIX ACTIONS                                                      */
/* =================================================================== */

function FixActions({ final }: { final: FinalResult }) {
  if (final.ok || final.fix.length === 0) {
    return <p className="text-xs text-muted-foreground">No action required.</p>;
  }
  return (
    <ol className="space-y-3">
      {final.fix.map((s, i) => (
        <li key={i} className="flex gap-3 rounded-md border border-border/50 bg-card/40 px-4 py-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/15 text-xs font-bold text-info">
            {i + 1}
          </span>
          <span className="text-sm leading-relaxed">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/* =================================================================== */
/* 6. SECONDARY FINDINGS                                               */
/* =================================================================== */

function SecondaryFindings({ final }: { final: FinalResult }) {
  return (
    <ul className="space-y-3">
      {final.secondaryFindings.map((f, i) => (
        <li key={i} className="rounded-md border border-border/50 bg-card/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{f.source}</span>
            <span className="text-sm font-semibold">{f.breakAt}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{f.why}</p>
        </li>
      ))}
    </ul>
  );
}

/* =================================================================== */
/* Section title                                                       */
/* =================================================================== */

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
      {n} · {title}
    </h2>
  );
}

/* =================================================================== */
/* CCP / Network panels                                                */
/* =================================================================== */

function CollapsiblePanel({
  title, children, defaultOpen = false,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border/50 bg-card/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted/20">
            <span className="font-medium">{title}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/40 px-4 py-3 text-xs">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function CcpPanelBody({ snap }: { snap: DiagnosisRunSnapshot }) {
  const ccp = snap.ccpParse;
  if (ccp.status === "not_provided") {
    return <p className="text-muted-foreground">CCP not provided — config validation skipped.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Controllers"   value={ccp.controllers.length} />
        <Stat label="Rooms"         value={ccp.rooms.length} />
        <Stat label="Devices"       value={ccp.devices.length} />
        <Stat label="Group Signals" value={ccp.groupSignals.length} />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Status: <span className="font-mono text-foreground">{ccp.status}</span> · Confidence: <span className="font-mono text-foreground">{ccp.confidence}</span>
      </div>
      {snap.ccpFindings.length > 0 && (
        <ul className="space-y-1.5">
          {snap.ccpFindings.map((f, i) => (
            <li key={i} className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                  f.severity === "Critical" ? "bg-critical/15 text-critical" :
                  f.severity === "Warning"  ? "bg-warning/15 text-warning" :
                                              "bg-muted/30 text-muted-foreground",
                )}>{f.severity}</span>
                <span className="text-xs font-medium">{f.title}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NetworkPanelBody({ snap }: { snap: DiagnosisRunSnapshot }) {
  const n = snap.network;
  if (!n) return <p className="text-muted-foreground">Network truth not verified — SNMP / scan / ARP not available.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Switches"    value={n.switches.length} />
        <Stat label="Connections" value={n.resolvedConnections.length} />
        <Stat label="ARP entries" value={n.arp.length} />
        <Stat label="Findings"    value={n.findings.length} />
      </div>
      {n.findings.length > 0 && (
        <ul className="space-y-1.5">
          {n.findings.slice(0, 8).map((f, i) => (
            <li key={i} className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                  f.severity === "Critical" ? "bg-critical/15 text-critical" :
                  f.severity === "Warning"  ? "bg-warning/15 text-warning" :
                                              "bg-muted/30 text-muted-foreground",
                )}>{f.severity}</span>
                <span className="text-xs font-medium">{f.title}</span>
                {!f.verified && <span className="ml-auto text-[10px] text-muted-foreground">unverified</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/40 bg-background/30 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* =================================================================== */
/* Copy summary                                                        */
/* =================================================================== */

function buildSummary(final: FinalResult, snap: DiagnosisRunSnapshot): string {
  const site = snap.payload?.name ?? "Site";
  const lines: string[] = [];
  lines.push(`TACERA DOCTOR — ${site}`);
  lines.push("");
  lines.push(`BREAK FOUND AT: ${final.ok ? "No break detected" : final.breakAt}`);
  lines.push("");
  lines.push(`PRIMARY CAUSE: ${final.ok ? "End-to-end signal path operational" : decisiveCause(final)}`);
  lines.push("");
  if (final.evidence.length) {
    lines.push("PROOF:");
    final.evidence.slice(0, 3).forEach((e) => lines.push(`  - ${e}`));
    lines.push("");
  }
  lines.push(`CONFIDENCE: ${final.confidence}% (${final.confidence >= 95 ? "High" : final.confidence >= 80 ? "Strong" : final.confidence >= 60 ? "Moderate" : "Low"})`);
  lines.push("");
  if (!final.ok && final.fix.length) {
    lines.push("FIX NOW:");
    final.fix.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push("");
  }
  lines.push(`Truth — Network: ${final.truth.network} · CCP: ${final.truth.ccp} · Behavior: ${final.truth.behavior}`);
  return lines.join("\n");
}
