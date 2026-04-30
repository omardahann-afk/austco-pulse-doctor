import type { DiagnosticIssue } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "./SeverityBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { Sparkles } from "lucide-react";

export function RootCausePanel({ issues, limit = 5 }: { issues: DiagnosticIssue[]; limit?: number }) {
  return (
    <Card className="border-insight/30 bg-card/80 shadow-[var(--shadow-panel)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-insight" />
          Root Cause Ranking
          <span className="ml-2 rounded-full bg-insight/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-insight">Cross-module correlation</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {issues.slice(0, limit).map((iss, i) => (
          <div key={iss.id} className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/10 p-2.5">
            <div className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-insight/40 bg-insight/10 font-mono text-[11px] text-insight">{i + 1}</div>
            <div className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{iss.title}</span>
                <SeverityBadge severity={iss.severity} />
                <ConfidenceBadge confidence={iss.confidence} />
              </div>
              <p className="text-xs text-muted-foreground">{iss.likelyRootCause}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
