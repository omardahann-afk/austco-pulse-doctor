import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleProgressList } from "@/components/ModuleProgressList";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { useDiagnostic, startFullDiagnosis } from "@/lib/diagnosticStore";
import { DIAGNOSTIC_MODULES } from "@/lib/diagnosticEngine";
import { ScanLine, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/diagnose")({
  head: () => ({ meta: [{ title: "Run Full Diagnosis — Austco Site Doctor" }] }),
  component: FullDiagnosis,
});

function FullDiagnosis() {
  const { isScanning, modules, result } = useDiagnostic();
  const list = modules.length ? modules : DIAGNOSTIC_MODULES.map(m => ({ ...m, status: "Pending" as const, findings: [] as string[] }));
  const passed = modules.filter(m => m.status === "Passed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Full Diagnostic Chain · 14 modules"
        title="Run Full Austco Diagnosis"
        description="Walks the full chain: laptop → switch → VIP → server → Pulse services → CCT logic → controllers → IP-IN8 / IP-APP1 / signal lights."
        actions={
          <Button onClick={startFullDiagnosis} disabled={isScanning} className="bg-info text-info-foreground hover:bg-info/90">
            {isScanning ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Scanning…</> : <><ScanLine className="mr-1.5 h-4 w-4" />Start Full Diagnosis</>}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><ModuleProgressList modules={list} /></div>
        <div className="space-y-3 lg:col-span-2">
          <Card className="bg-card/70">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Scan progress</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{passed}/{list.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">modules completed</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-info transition-all" style={{ width: `${(passed/list.length)*100}%` }} />
              </div>
            </CardContent>
          </Card>
          {result && (
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-4 w-4" />Final diagnosis</div>
                <p className="mt-1 text-foreground/90">CCT logic verified. Programming is not the suspected failure point.</p>
                <p className="text-foreground/90">Primary server is active and VIP is responding. Output event was generated successfully.</p>
                <p className="text-critical">Controller West Wing did not acknowledge the output command.</p>
                <p className="text-foreground/90">Signal light failure is likely occurring between server event delivery and controller/output execution.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Findings ({result.issues.length})</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {result.rootCauseRanking.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
          </div>
        </div>
      )}
    </div>
  );
}
