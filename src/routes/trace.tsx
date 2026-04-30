import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TraceCallPanel } from "@/components/TraceCallPanel";
import { traceLiveCall } from "@/lib/eventTraceEngine";
import type { TraceStep } from "@/lib/types";
import { Play, Loader2, AlertOctagon } from "lucide-react";

export const Route = createFileRoute("/trace")({
  head: () => ({ meta: [{ title: "Trace This Call — Austco Site Doctor" }] }),
  component: TracePage,
});

function TracePage() {
  const [room, setRoom] = useState("Room 230");
  const [callType, setCallType] = useState("Bedside Call");
  const [group, setGroup] = useState("East Wing Signal Lights");
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [running, setRunning] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [failPoint, setFailPoint] = useState<string | null>(null);

  async function start() {
    setRunning(true); setDiag(null); setFailPoint(null); setSteps([]);
    const result = await traceLiveCall({ room, callType, expectedGroup: group }, setSteps);
    setDiag(result.finalDiagnosis); setFailPoint(result.failurePoint ?? null); setRunning(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Killer feature" title="Trace This Call" description="Activate a real call — watch the signal walk every layer of the Austco chain in real time." />

      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Trace setup</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5"><Label className="text-xs">Room number</Label><Input value={room} onChange={e=>setRoom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Call type</Label><Input value={callType} onChange={e=>setCallType(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Expected group / output</Label><Input value={group} onChange={e=>setGroup(e.target.value)} /></div>
            <div className="flex items-end">
              <Button onClick={start} disabled={running} className="w-full bg-info text-info-foreground hover:bg-info/90">
                {running ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Tracing…</> : <><Play className="mr-1.5 h-4 w-4" />Start Live Trace</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {steps.length > 0 && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-base">Live chain</CardTitle></CardHeader>
          <CardContent><TraceCallPanel steps={steps} /></CardContent>
        </Card>
      )}

      {diag && (
        <Card className={failPoint ? "border-critical/40 bg-critical/5" : "border-success/40 bg-success/5"}>
          <CardContent className="space-y-1 p-4 text-sm">
            <div className={`flex items-center gap-2 font-semibold ${failPoint ? "text-critical" : "text-success"}`}>
              <AlertOctagon className="h-4 w-4" />Final diagnosis
            </div>
            <p>{diag}</p>
            {failPoint && <p className="text-xs text-muted-foreground">Failure point: {failPoint}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
