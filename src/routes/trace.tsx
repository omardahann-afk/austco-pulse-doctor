import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BreakpointMap } from "@/components/BreakpointMap";
import { BreakpointReport } from "@/components/BreakpointReport";
import { traceSignalPath, type ChainStep, type Breakpoint } from "@/lib/breakpointEngine";
import { Play, Loader2 } from "lucide-react";

export const Route = createFileRoute("/trace")({
  head: () => ({ meta: [{ title: "Trace Signal Path — Austco Site Doctor" }] }),
  component: TracePage,
});

function TracePage() {
  const [room, setRoom] = useState("Room 230");
  const [ipin8Ip, setIpin8Ip] = useState("10.20.5.40");
  const [controllerIp, setControllerIp] = useState("10.20.4.22");
  const [expectedGroup, setExpectedGroup] = useState("East Wing Signal Lights");
  const [ipapp1Ip, setIpapp1Ip] = useState("10.20.6.30");
  const [signalLightIp, setSignalLightIp] = useState("10.20.7.50");

  const [steps, setSteps] = useState<ChainStep[]>([]);
  const [running, setRunning] = useState(false);
  const [bp, setBp] = useState<Breakpoint | null>(null);
  const [conclusion, setConclusion] = useState<string>("");

  async function start() {
    setRunning(true); setBp(null); setConclusion(""); setSteps([]);
    const result = await traceSignalPath(
      { room, ipin8Ip, controllerIp, expectedGroup, ipapp1Ip, signalLightIp },
      setSteps,
    );
    setBp(result.breakpoint);
    setConclusion(result.conclusion);
    setRunning(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hardware breakpoint detection"
        title="Trace Signal Path"
        description="Walk the full Austco signal chain — Laptop → VLAN → Pulse Gateway → IPConnect → Controller → IP-IN8 / IP-APP1 / Signal Light — and pinpoint the exact failed handoff."
      />

      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Trace setup</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Room number" value={room} onChange={setRoom} />
            <Field label="IP-IN8 / Input IP" value={ipin8Ip} onChange={setIpin8Ip} mono />
            <Field label="Controller IP" value={controllerIp} onChange={setControllerIp} mono />
            <Field label="Expected output group" value={expectedGroup} onChange={setExpectedGroup} />
            <Field label="IP-APP1 / Display IP" value={ipapp1Ip} onChange={setIpapp1Ip} mono />
            <Field label="Signal light / Zone IP" value={signalLightIp} onChange={setSignalLightIp} mono />
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={start} disabled={running} className="bg-info text-info-foreground hover:bg-info/90">
              {running ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Tracing signal path…</> : <><Play className="mr-1.5 h-4 w-4" />Trace Signal Path</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {steps.length > 0 && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-base">Breakpoint Map · Live chain</CardTitle></CardHeader>
          <CardContent><BreakpointMap steps={steps} /></CardContent>
        </Card>
      )}

      {(bp || conclusion) && <BreakpointReport bp={bp} conclusion={conclusion} />}
    </div>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={mono ? "font-mono text-xs" : ""} />
    </div>
  );
}
