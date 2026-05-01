import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loader2, ScanLine } from "lucide-react";
import { DEFAULT_PAYLOAD, type DiagnosisRequest } from "@/lib/siteDoctorApi";
import {
  buildRoomControllerReports,
  traceCallpointSim046,
  type RcTraceStep, type RcTraceBreak,
} from "@/lib/roomControllerDoctor";
import {
  RoomControllerDoctorPanel,
  IpnetDeviceTreePanel,
  RoomControllerBreakpointMap,
  EventViewerPaste,
} from "@/components/RoomControllerPanel";

export const Route = createFileRoute("/room-controllers")({
  head: () => ({ meta: [
    { title: "Room Controller Doctor — Austco Site Doctor" },
    { name: "description", content: "SIM-046 Room Controller / IPnet Router diagnostics: validation, IPnet device tree, callpoint breakpoint map, Event Viewer parsing." },
  ]}),
  component: RoomControllersPage,
});

function RoomControllersPage() {
  const [payload, setPayload] = useState<DiagnosisRequest>(() => structuredClone(DEFAULT_PAYLOAD));
  const [tracing, setTracing] = useState(false);
  const [steps, setSteps] = useState<RcTraceStep[]>([]);
  const [bp, setBp] = useState<RcTraceBreak | null>(null);
  const [conclusion, setConclusion] = useState("");

  const reports = useMemo(() => buildRoomControllerReports(payload), [payload]);
  const cp = payload.callPoints?.[0] ?? null;

  function setEventViewer(controllerName: string, text: string) {
    setPayload((p) => ({
      ...p,
      roomControllers: (p.roomControllers ?? []).map((c) =>
        c.name === controllerName ? { ...c, eventViewerText: text } : c,
      ),
    }));
  }

  async function runTrace() {
    if (!cp) return;
    setTracing(true); setSteps([]); setBp(null); setConclusion("");
    try {
      const res = await traceCallpointSim046(payload, cp, setSteps, 140);
      setBp(res.breakpoint);
      setConclusion(res.conclusion);
    } finally {
      setTracing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="SIM-046"
        title="Room Controller / IPnet Router Doctor"
        description="Validates Room Controllers against SIM-046 rules, maps IPnet devices, parses Event Viewer logs, and traces callpoint → output breakpoints."
      />

      <RoomControllerDoctorPanel reports={reports} />
      <IpnetDeviceTreePanel reports={reports} />

      {(payload.roomControllers ?? []).map((c) => (
        <EventViewerPaste
          key={c.name}
          controllerName={c.name}
          value={c.eventViewerText ?? ""}
          onChange={(t) => setEventViewer(c.name, t)}
        />
      ))}

      {cp && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Trace this call: <span className="font-mono text-foreground">{cp.name}</span> · controller <span className="font-mono text-foreground">{cp.controller}</span>
            </div>
            <Button onClick={runTrace} disabled={tracing} size="sm" className="bg-info text-info-foreground hover:bg-info/90">
              {tracing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Tracing…</> : <><ScanLine className="mr-2 h-4 w-4" />Trace This Call</>}
            </Button>
          </div>
          {steps.length > 0 && (
            <RoomControllerBreakpointMap
              callPoint={cp} steps={steps} breakpoint={bp} conclusion={conclusion}
            />
          )}
        </div>
      )}
    </div>
  );
}
