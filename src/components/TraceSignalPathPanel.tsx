import { useState } from "react";
import type { TraceResult, TraceNode, TraceNodeStatus } from "@/lib/agentClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, AlertTriangle, MinusCircle, ChevronDown, ChevronRight,
  Activity, Wrench, ShieldOff, Clock, GitBranch, Layers, Info, ArrowRight, ArrowDown,
} from "lucide-react";

type ResolvedTrace = Extract<TraceResult, { ok: true }>;

const STATUS_TONE: Record<TraceNodeStatus, { cls: string; icon: typeof CheckCircle2; label: string }> = {
  SIGNAL_RECEIVED:    { cls: "border-success/50 bg-success/10 text-success",        icon: CheckCircle2,   label: "SIGNAL RECEIVED" },
  EVENT_PROPAGATED:   { cls: "border-success/50 bg-success/10 text-success",        icon: CheckCircle2,   label: "EVENT PROPAGATED" },
  EVENT_ROUTED:       { cls: "border-success/50 bg-success/10 text-success",        icon: CheckCircle2,   label: "EVENT ROUTED" },
  TIMEOUT:            { cls: "border-critical/60 bg-critical/15 text-critical shadow-[0_0_24px_-6px_var(--critical)]", icon: XCircle, label: "TIMEOUT" },
  CONFIG_MISMATCH:    { cls: "border-warning/60 bg-warning/15 text-warning",        icon: AlertTriangle,  label: "CONFIG MISMATCH" },
  UNREACHABLE:        { cls: "border-critical/60 bg-critical/15 text-critical",     icon: XCircle,        label: "UNREACHABLE" },
  HOST_REACHABLE_PORT_CLOSED: { cls: "border-warning/60 bg-warning/15 text-warning", icon: AlertTriangle, label: "HOST REACHABLE / PORT CLOSED" },
  NOT_CONFIGURED:     { cls: "border-border bg-muted/20 text-muted-foreground",     icon: MinusCircle,    label: "NOT CONFIGURED" },
  NO_EVIDENCE:        { cls: "border-border bg-muted/20 text-muted-foreground",     icon: Info,           label: "NO EVIDENCE" },
  UNKNOWN:            { cls: "border-border bg-muted/20 text-muted-foreground",     icon: Info,           label: "UNKNOWN" },
};

function overallTone(s: ResolvedTrace["overallStatus"]) {
  switch (s) {
    case "PROPAGATED":  return { cls: "bg-success/15 text-success",   label: "PROPAGATED" };
    case "PARTIAL":     return { cls: "bg-warning/15 text-warning",   label: "PARTIAL" };
    case "BROKEN":      return { cls: "bg-critical/15 text-critical", label: "BROKEN" };
    default:            return { cls: "bg-muted/30 text-muted-foreground", label: "NO EVIDENCE" };
  }
}

function NodeCard({
  node, expanded, onToggle, orientation,
}: { node: TraceNode; expanded: boolean; onToggle: () => void; orientation: "vertical" | "horizontal" }) {
  const tone = STATUS_TONE[node.status];
  const Icon = tone.icon;
  return (
    <div className={cn(
      "rounded-lg border p-2.5 transition",
      tone.cls,
      orientation === "horizontal" ? "min-w-[200px] max-w-[240px]" : "w-full",
    )}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{node.layer}</span>
            {node.breakDetected && <span className="rounded bg-critical/20 px-1 py-px text-[9px] font-bold tracking-wide text-critical">BREAK</span>}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold">{node.componentName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] opacity-80">
            <span className="rounded bg-background/40 px-1.5 py-0.5 font-mono">{tone.label}</span>
            {node.confidence > 0 && <span className="rounded bg-background/40 px-1.5 py-0.5">{node.confidence}%</span>}
            {node.timestamp && <span className="font-mono">{node.timestamp}</span>}
          </div>
        </div>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      </button>
      {expanded && node.evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-current/20 pt-2 font-mono text-[10.5px] leading-snug opacity-90">
          {node.evidence.map((e, i) => <li key={i}>· {e}</li>)}
        </ul>
      )}
    </div>
  );
}

export function TraceSignalPathPanel({ trace }: { trace: ResolvedTrace }) {
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const n of trace.propagationPath) if (n.breakDetected) init[n.layer] = true;
    return init;
  });
  const [showTimeline, setShowTimeline] = useState(false);
  const [showRuled, setShowRuled] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const ot = overallTone(trace.overallStatus);
  const target = trace.traceTarget;

  return (
    <div className="space-y-3">
      <Card className="border-insight/30 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-insight" /> Trace Signal Path
            </CardTitle>
            <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", ot.cls)}>{ot.label}</span>
            <span className="ml-auto inline-flex overflow-hidden rounded-md border border-border/60 text-[11px]">
              <button type="button" onClick={() => setOrientation("vertical")}
                className={cn("flex items-center gap-1 px-2 py-1", orientation === "vertical" ? "bg-info/15 text-info" : "text-muted-foreground hover:bg-muted/30")}>
                <ArrowDown className="h-3 w-3" /> Vertical
              </button>
              <button type="button" onClick={() => setOrientation("horizontal")}
                className={cn("flex items-center gap-1 px-2 py-1", orientation === "horizontal" ? "bg-info/15 text-info" : "text-muted-foreground hover:bg-muted/30")}>
                <ArrowRight className="h-3 w-3" /> Horizontal
              </button>
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {/* Target + summary */}
          <div className="rounded-lg border-l-[6px] border-l-insight bg-insight/5 p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-insight">Trace Target</span>
              <span className="font-mono text-sm font-semibold">{target.label}</span>
              <span className="ml-auto rounded bg-background/60 px-2 py-0.5 text-[10px] font-mono">kind: {target.kind}</span>
            </div>
            <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2 md:grid-cols-4">
              <Stat label="Signal" value={trace.signalStatus} />
              <Stat label="Confidence" value={`${trace.confidence}%`} />
              <Stat label="Break Found At" value={trace.breakFoundAt || "—"} accent={trace.breakFoundAt ? "bad" : "ok"} />
              <Stat label="Path Hops" value={`${trace.propagationPath.length}`} />
            </div>
          </div>

          {/* Propagation path */}
          {orientation === "vertical" ? (
            <div className="space-y-1.5">
              {trace.propagationPath.map((n, i) => (
                <div key={n.layer}>
                  <NodeCard
                    node={n}
                    orientation="vertical"
                    expanded={!!expanded[n.layer]}
                    onToggle={() => setExpanded((p) => ({ ...p, [n.layer]: !p[n.layer] }))}
                  />
                  {i < trace.propagationPath.length - 1 && (
                    <div className="flex items-center justify-center py-0.5">
                      <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex min-w-max items-stretch gap-1.5 p-1">
                {trace.propagationPath.map((n, i) => (
                  <div key={n.layer} className="flex items-center gap-1">
                    <NodeCard
                      node={n}
                      orientation="horizontal"
                      expanded={!!expanded[n.layer]}
                      onToggle={() => setExpanded((p) => ({ ...p, [n.layer]: !p[n.layer] }))}
                    />
                    {i < trace.propagationPath.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suspected failure */}
          {trace.suspectedFailures.length > 0 && (
            <div className="rounded-lg border border-critical/40 bg-critical/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-critical">
                <AlertTriangle className="h-3 w-3" /> Suspected Failure
              </div>
              {trace.suspectedFailures.map((f, i) => (
                <div key={i} className="text-xs">
                  <div className="font-semibold">{f.layer} · {f.componentName} · <span className="font-mono text-[10px]">{f.reason}</span> · {f.confidence}%</div>
                  <p className="mt-0.5 text-foreground/85">{f.explanation}</p>
                </div>
              ))}
            </div>
          )}

          {/* Timing */}
          {trace.timing.hops.length > 0 && (
            <div className="rounded border border-border/40 bg-background/40">
              <button type="button" onClick={() => setShowTimeline((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  {showTimeline ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <Clock className="h-3.5 w-3.5" /> Trace Timeline ({trace.timing.hops.length} hop{trace.timing.hops.length === 1 ? "" : "s"})
                </span>
              </button>
              {showTimeline && (
                <ul className="space-y-0.5 border-t border-border/40 p-2 font-mono text-[11px]">
                  {trace.timing.hops.map((h, i) => (
                    <li key={i}>· {h.from} → {h.to}: {h.deltaMs >= 0 ? `${h.deltaMs}ms` : `(out of order ${h.deltaMs}ms)`}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Ruled out */}
          {trace.ruledOutFailures.length > 0 && (
            <div className="rounded border border-border/40 bg-background/40">
              <button type="button" onClick={() => setShowRuled((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  {showRuled ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <ShieldOff className="h-3.5 w-3.5" /> Ruled Out ({trace.ruledOutFailures.length})
                </span>
              </button>
              {showRuled && (
                <ul className="space-y-0.5 border-t border-border/40 p-2 text-xs">
                  {trace.ruledOutFailures.map((r, i) => (
                    <li key={i} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3 w-3 text-success" />{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Fix actions */}
          {trace.fixActions.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Wrench className="h-3 w-3" /> Fix Actions
              </div>
              <ol className="space-y-1 text-sm">
                {trace.fixActions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[10px]">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Notes */}
          {trace.notes.length > 0 && (
            <div className="rounded border border-border/40 bg-muted/10 p-2 text-[11px] text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wider"><Info className="h-3 w-3" /> Notes</div>
              <ul className="space-y-0.5">
                {trace.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            </div>
          )}

          {/* Raw evidence */}
          <div className="rounded border border-border/40 bg-background/40">
            <button type="button" onClick={() => setShowRaw((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                {showRaw ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Layers className="h-3.5 w-3.5" /> Raw Evidence ({trace.evidence.length})
              </span>
            </button>
            {showRaw && (
              <pre className="max-h-72 overflow-auto border-t border-border/40 bg-background/70 p-2 font-mono text-[10.5px] whitespace-pre-wrap">
{trace.evidence.join("\n")}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "ok" | "bad" }) {
  return (
    <div className={cn(
      "rounded-md border p-2",
      accent === "ok" ? "border-success/40 bg-success/5"
        : accent === "bad" ? "border-critical/40 bg-critical/5"
        : "border-border/50 bg-background/30",
    )}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs">{value}</div>
    </div>
  );
}
