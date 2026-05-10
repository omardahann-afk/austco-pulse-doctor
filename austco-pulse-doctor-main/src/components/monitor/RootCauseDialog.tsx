import { useEffect, useState } from "react";
import { Loader2, Brain } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { intelligenceApi, type Alert, type RootCauseAssist } from "@/lib/intelligenceClient";

export function RootCauseDialog({
  alert,
  open,
  onOpenChange,
}: {
  alert: Alert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RootCauseAssist | null>(null);

  useEffect(() => {
    if (!open || !alert) return;
    setData(null);
    setLoading(true);
    intelligenceApi
      .rootCauseAssist({
        deviceId: alert.deviceId,
        alertId: alert.alertId,
        snapshotId: alert.snapshotId,
        recentEvents: [{ patternId: alert.patternIds?.[0], recommendedNextCheck: alert.recommendedNextCheck }],
        patterns: alert.patternIds,
        probe: null,
        logs: alert.evidence?.map((e) => (typeof (e as { line?: string }).line === "string" ? (e as { line: string }).line : JSON.stringify(e))) ?? [],
      })
      .then(setData)
      .finally(() => setLoading(false));
  }, [open, alert]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Brain className="h-4 w-4" /> AI Root Cause — {alert?.title}
          </DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analysing deterministic evidence…
          </div>
        )}
        {!loading && data?.response && (
          <div className="space-y-3 text-xs">
            <Section title="Plain-English root cause">{data.response.plainEnglishRootCause}</Section>
            {data.response.whyThisLooksLikely && <Section title="Why this looks likely">{data.response.whyThisLooksLikely}</Section>}
            {Array.isArray(data.response.recommendedNextChecks) && data.response.recommendedNextChecks.length > 0 && (
              <Section title="Recommended next checks">
                <ul className="list-inside list-disc space-y-0.5">
                  {data.response.recommendedNextChecks.map((c, i) => <li key={i}>{String(c)}</li>)}
                </ul>
              </Section>
            )}
            {data.response.customerSafeSummary && <Section title="Customer-safe summary">{data.response.customerSafeSummary}</Section>}
            {data.response.escalationDraft && <Section title="Escalation draft">{data.response.escalationDraft}</Section>}
            {data.response.confidenceWarning && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                {data.response.confidenceWarning}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">{data.response.safetyDisclaimer}</div>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/10 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-1 text-foreground/90">{children}</div>
    </div>
  );
}