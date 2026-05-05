import { useState } from "react";
import type { RootCauseAnalysis, RootCauseLayer } from "@/lib/siteConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Check, ChevronDown, ChevronRight, Layers, ShieldOff, ListChecks, Wrench, Activity, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const LAYERS: RootCauseLayer[] = ["network", "access", "service", "application", "configuration", "dependency"];

function confidenceTone(c: number): string {
  if (c >= 85) return "text-success";
  if (c >= 65) return "text-info";
  if (c >= 40) return "text-warning";
  return "text-muted-foreground";
}

function statusBadge(s: RootCauseAnalysis["overallStatus"]): { cls: string; label: string } {
  switch (s) {
    case "PASS": return { cls: "bg-success/15 text-success", label: "PASS" };
    case "WARN": return { cls: "bg-warning/15 text-warning", label: "WARN" };
    case "FAIL": return { cls: "bg-critical/15 text-critical", label: "FAIL" };
    default:     return { cls: "bg-muted/30 text-muted-foreground", label: "INSUFFICIENT" };
  }
}

export function AdvancedRootCausePanel({ rc }: { rc: RootCauseAnalysis }) {
  const [openLayer, setOpenLayer] = useState<RootCauseLayer | null>(null);
  const [openTimeline, setOpenTimeline] = useState(false);
  const [openDev, setOpenDev] = useState(false);
  const [copied, setCopied] = useState(false);
  const sb = statusBadge(rc.overallStatus);

  function copyDev() {
    navigator.clipboard.writeText(rc.developerSummary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card className="border-insight/30 bg-card/80 shadow-[var(--shadow-panel)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-insight" />
            Root Cause Analysis
          </CardTitle>
          <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", sb.cls)}>{sb.label}</span>
          <span className="ml-auto rounded-full bg-muted/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Deterministic · evidence-based · AI cannot override
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* 1. Primary Root Cause + 2. Break Found At + 3. Confidence */}
        <div className="rounded-lg border-l-[6px] border-l-insight bg-insight/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-insight">Primary Root Cause</div>
          <div className="mt-1 text-base font-semibold">{rc.primaryRootCause.title}</div>
          <p className="mt-1 text-xs text-foreground/80">{rc.primaryRootCause.explanation}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded bg-background/60 px-2 py-0.5 font-mono">layer: {rc.primaryRootCause.layer}</span>
            <span className="rounded bg-background/60 px-2 py-0.5">Break found at: <span className="font-semibold">{rc.breakFoundAt}</span></span>
            <span className={cn("rounded bg-background/60 px-2 py-0.5 font-semibold", confidenceTone(rc.confidence))}>Confidence: {rc.confidence}%</span>
          </div>
        </div>

        {/* Confidence breakdown */}
        {rc.confidenceBreakdown.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3 w-3" /> Confidence breakdown
            </div>
            <ul className="space-y-0.5 font-mono text-[11px] text-foreground/80">
              {rc.confidenceBreakdown.map((c, i) => <li key={i}>· {c}</li>)}
            </ul>
          </div>
        )}

        {/* 4. Evidence Timeline (collapsed) */}
        {rc.evidenceTimeline.length > 0 && (
          <div className="rounded border border-border/50 bg-background/40">
            <button type="button" onClick={() => setOpenTimeline((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                {openTimeline ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Evidence Timeline ({rc.evidenceTimeline.length})
              </span>
              <span className="text-[10px] text-muted-foreground">chronological log lines</span>
            </button>
            {openTimeline && (
              <div className="border-t border-border/40 p-3">
                <ul className="space-y-1 font-mono text-[11px] text-foreground/85">
                  {rc.evidenceTimeline.map((t, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      <span className="text-muted-foreground">{t.ts}</span>
                      <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px]">{t.service}</span>
                      <span className="rounded bg-info/15 px-1.5 py-0.5 text-[10px] text-info">{t.type}</span>
                      {t.cpId && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">cp={t.cpId}</span>}
                      <span className="text-foreground/80">{t.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 5. Evidence by Layer */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3 w-3" /> Evidence by Layer
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3">
            {LAYERS.map((layer) => {
              const lines = rc.evidenceByLayer[layer] || [];
              const isOpen = openLayer === layer;
              return (
                <button key={layer} type="button"
                  onClick={() => setOpenLayer(isOpen ? null : layer)}
                  className={cn("rounded border px-2 py-1.5 text-left text-xs transition",
                    lines.length === 0 ? "border-border/30 bg-muted/10 text-muted-foreground" : "border-border/60 bg-background/40 hover:border-info/50")}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold capitalize">{layer}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                      lines.length === 0 ? "bg-muted/20 text-muted-foreground" : "bg-info/15 text-info")}>
                      {lines.length}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {openLayer && (rc.evidenceByLayer[openLayer]?.length ?? 0) > 0 && (
            <div className="mt-2 rounded border border-border/40 bg-background/60 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{openLayer} layer ({rc.evidenceByLayer[openLayer].length})</div>
              <ul className="space-y-0.5 font-mono text-[11px] text-foreground/85">
                {rc.evidenceByLayer[openLayer].map((line, i) => <li key={i}>· {line}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* 6. Affected Callpoints */}
        {rc.affectedCallpoints.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Affected Callpoints</div>
            <div className="flex flex-wrap gap-1.5">
              {rc.affectedCallpoints.slice(0, 50).map((cp) => (
                <span key={cp} className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{cp}</span>
              ))}
              {rc.affectedCallpoints.length > 50 && (
                <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground">+{rc.affectedCallpoints.length - 50} more</span>
              )}
            </div>
          </div>
        )}

        {/* 7. Secondary Findings */}
        {rc.secondaryFindings.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Secondary Findings</div>
            <ul className="space-y-1.5">
              {rc.secondaryFindings.map((s, i) => (
                <li key={i} className="rounded border border-border/40 bg-muted/10 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{s.title}</span>
                    <span className="rounded bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.layer}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{s.explanation}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 8. Ruled Out Causes */}
        {rc.ruledOutCauses.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <ShieldOff className="h-3 w-3" /> Ruled Out
            </div>
            <ul className="space-y-1 text-xs text-foreground/80">
              {rc.ruledOutCauses.map((r, i) => (
                <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-3 w-3 text-success" />{r}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 9. Fix Actions */}
        {rc.fixActions.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Wrench className="h-3 w-3" /> Fix Actions
            </div>
            <ol className="space-y-1 text-sm">
              {rc.fixActions.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[10px]">{i + 1}</span>
                  <span className="text-foreground/90">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Escalation summary */}
        {rc.escalationSummary && (
          <div className="rounded border border-border/50 bg-background/40 p-2.5 text-xs">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <ListChecks className="h-3 w-3" /> Escalation Summary
            </div>
            <p className="text-foreground/85">{rc.escalationSummary}</p>
          </div>
        )}

        {/* 10. Developer Summary (copyable) */}
        <div className="rounded border border-border/50 bg-background/40">
          <button type="button" onClick={() => setOpenDev((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              {openDev ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <BookOpen className="h-3.5 w-3.5" /> Developer Summary
            </span>
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]"
              onClick={(e) => { e.stopPropagation(); copyDev(); }}>
              {copied ? <><Check className="mr-1 h-3 w-3" />Copied</> : <><Copy className="mr-1 h-3 w-3" />Copy</>}
            </Button>
          </button>
          {openDev && (
            <pre className="max-h-96 overflow-auto border-t border-border/40 bg-background/70 p-3 font-mono text-[10.5px] whitespace-pre-wrap text-foreground/85">
{rc.developerSummary}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
