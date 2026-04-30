import type { CallPointStep, CallPointBreakpoint } from "@/lib/callPointTrace";
import type { CallPointEntry } from "@/lib/siteDoctorApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, Circle, MinusCircle, ChevronRight, AlertOctagon, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export function CallPointTracePanel({
  callPoint, steps, breakpoint, conclusion,
}: {
  callPoint: CallPointEntry;
  steps: CallPointStep[];
  breakpoint: CallPointBreakpoint | null;
  conclusion: string;
}) {
  return (
    <div className="space-y-3">
      <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span>Call Point → Output Trace · {callPoint.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{callPoint.controller} · input {callPoint.inputIndex} → {callPoint.expectedOutputGroup}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-stretch gap-1.5 p-1">
              {steps.map((s, i) => {
                const tone =
                  s.status === "Passed" ? "border-success/50 bg-success/10 text-success" :
                  s.status === "Failed" ? "border-critical/60 bg-critical/15 text-critical shadow-[0_0_24px_-6px_var(--critical)]" :
                  s.status === "Running" ? "border-info/60 bg-info/10 text-info" :
                  s.status === "Skipped" ? "border-border bg-muted/20 text-muted-foreground opacity-60" :
                  "border-border bg-muted/20 text-muted-foreground";
                const Icon =
                  s.status === "Passed" ? CheckCircle2 :
                  s.status === "Failed" ? XCircle :
                  s.status === "Running" ? Loader2 :
                  s.status === "Skipped" ? MinusCircle : Circle;
                return (
                  <div key={s.id} className="flex items-center gap-1">
                    <div className={cn("min-w-[170px] max-w-[210px] rounded-lg border p-2", tone)}>
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5", s.status === "Running" && "animate-spin")} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">{s.layer}</span>
                      </div>
                      <div className="mt-1 text-xs font-medium leading-snug">{s.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug opacity-80">{s.detail}</div>
                    </div>
                    {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {breakpoint ? (
        <Card className="border-critical/50 bg-gradient-to-br from-critical/15 to-critical/5">
          <CardHeader className="pb-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-critical">Root Cause Analysis</div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertOctagon className="h-5 w-5 text-critical" /> Break found at: {breakpoint.breakPoint}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <Box label="Previous step passed" value={breakpoint.previousStepPassed} ok />
              <Box label="Failed step" value={breakpoint.failedStep} bad />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
              <ul className="space-y-0.5 rounded-md border border-border/50 bg-background/40 p-2 font-mono text-[11px]">
                {breakpoint.evidence.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Likely root cause</div>
              <p>{breakpoint.likelyRootCause}</p>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Wrench className="h-3 w-3" /> Technician fix steps</div>
              <ol className="list-decimal space-y-0.5 pl-5">
                {breakpoint.fix.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm"><CheckCircle2 className="h-5 w-5 text-success" /><span className="font-medium">{conclusion}</span></CardContent>
        </Card>
      )}
    </div>
  );
}

function Box({ label, value, ok, bad }: { label: string; value: string; ok?: boolean; bad?: boolean }) {
  const cls = ok ? "border-success/40 bg-success/5" : bad ? "border-critical/40 bg-critical/5" : "border-border/50 bg-background/30";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}