import type { DiagnosticIssue } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "./SeverityBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ChevronRight, MapPin, Wrench } from "lucide-react";

export function DiagnosticCard({ issue, rank }: { issue: DiagnosticIssue; rank?: number }) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-[var(--shadow-panel)]">
      <CardHeader className="pb-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {rank !== undefined && <span className="font-mono text-xs text-muted-foreground">#{rank.toString().padStart(2, "0")}</span>}
            <CardTitle className="text-base font-semibold">{issue.title}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} />
            <ConfidenceBadge confidence={issue.confidence} />
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground"><Wrench className="h-3 w-3" />{issue.module}</span>
            {issue.affectedDevice && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{issue.affectedDevice}{issue.affectedIp && <span className="font-mono text-[11px] opacity-80"> · {issue.affectedIp}</span>}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-foreground/90">{issue.whatIsHappening}</p>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
          <ul className="space-y-1">
            {issue.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-[12.5px] text-foreground/80">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-info" />{e}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-insight/30 bg-insight/5 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-insight">Likely root cause</div>
          <p className="text-sm">{issue.likelyRootCause}</p>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended steps</div>
          <ol className="space-y-1.5">
            {issue.recommendedSteps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[10px]">{i + 1}</span>
                <span className="text-foreground/90">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <span><span className="font-semibold text-foreground/90">Escalation:</span> {issue.escalationRecommendation}</span>
        </div>
      </CardContent>
    </Card>
  );
}
