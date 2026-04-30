import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/cct-reality")({ head: () => ({ meta: [{ title: "CCT Logic vs Reality — Austco Site Doctor" }] }), component: Page });

const ROWS = [
  { expected: "Room 230 active call should trigger East Wing group signal light.", observed: "Room 230 active call reached server. CCT logic matched. Output event generated. Signal light did not activate.", verdict: "fail" as const },
  { expected: "Room 214 cancel should clear nurse station call.", observed: "Server cancel processed. IP-APP1 did not acknowledge cancel push.", verdict: "fail" as const },
  { expected: "Basement Door 3 input should clear when external contact opens.", observed: "External contact still closed. Nurse call correctly reflects external state.", verdict: "ok" as const },
];

function Page() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Programming vs live behaviour" title="CCT Logic vs Reality" description="Compare what was programmed against what is actually happening on the site right now." />
      <Card className="border-success/30 bg-success/5">
        <CardContent className="p-4 text-sm">
          <div className="font-semibold text-success">Logic is not the suspected failure point. Live behavior indicates the issue occurs after event generation.</div>
          <p className="mt-1 text-muted-foreground">All active/cancel pairs valid · group/zone mapping complete · no conflicting logic.</p>
        </CardContent>
      </Card>
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Expected vs Observed</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Expected (CCT logic)</th><th className="px-3 py-2">Observed (live)</th><th className="px-3 py-2 w-24">Verdict</th></tr></thead>
              <tbody>
                {ROWS.map((r,i)=>(<tr key={i} className="border-t border-border/40 align-top">
                  <td className="px-3 py-2">{r.expected}</td>
                  <td className="px-3 py-2 text-foreground/90">{r.observed}</td>
                  <td className="px-3 py-2">{r.verdict==="ok" ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5"/>Match</span> : <span className="inline-flex items-center gap-1 text-critical"><XCircle className="h-3.5 w-3.5"/>Mismatch</span>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
