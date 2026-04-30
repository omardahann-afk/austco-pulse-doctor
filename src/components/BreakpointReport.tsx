import type { Breakpoint } from "@/lib/breakpointEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertOctagon, CheckCircle2, Wrench } from "lucide-react";

export function BreakpointReport({ bp, conclusion }: { bp: Breakpoint | null; conclusion: string }) {
  if (!bp) {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardContent className="flex items-center gap-2 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <span className="font-medium">{conclusion}</span>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-critical/50 bg-gradient-to-br from-critical/15 to-critical/5">
      <CardHeader className="pb-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-critical">Root Cause Analysis</div>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertOctagon className="h-5 w-5 text-critical" />
          Break found at: {bp.breakPoint}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Previous working step" value={bp.previousStepPassed} tone="ok" />
          <Field label="Failed step" value={bp.failedStep} tone="bad" />
          <Field label="Affected device" value={bp.affectedDevice} />
          <Field label="Failed layer" value={bp.failedLayer} tone="bad" />
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
          <ul className="space-y-0.5 rounded-md border border-border/50 bg-background/40 p-2 font-mono text-[11px]">
            {bp.evidence.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Likely cause</div>
          <p className="text-sm">{bp.likelyCause}</p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Wrench className="h-3 w-3" /> Technician fix steps
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm">
            {bp.recommendedFix.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  const cls = tone === "ok" ? "border-success/40 bg-success/5" : tone === "bad" ? "border-critical/40 bg-critical/5" : "border-border/50 bg-background/30";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}