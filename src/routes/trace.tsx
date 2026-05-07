import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadSiteConfig, loadServicesDiagnosis } from "@/lib/siteConfig";
import { runTrace, type TraceResult, type TraceTargetKind, type ServicesDiagnosis } from "@/lib/agentClient";
import { TraceSignalPathPanel } from "@/components/TraceSignalPathPanel";
import { AiCommanderTrigger } from "@/components/AiCommanderTrigger";
import { TraceContextCard } from "@/components/TraceContextCard";

export const Route = createFileRoute("/trace")({
  head: () => ({
    meta: [
      { title: "Trace Signal Path — Tacera Doctor" },
      { name: "description", content: "Trace a real Austco/Tacera signal end-to-end across the stack and find exactly where it breaks." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    deviceId: typeof s.deviceId === "string" ? s.deviceId : undefined,
    alertId: typeof s.alertId === "string" ? s.alertId : undefined,
    snapshotId: typeof s.snapshotId === "string" ? s.snapshotId : undefined,
  }),
  component: Page,
});

const KINDS: { value: TraceTargetKind; label: string; placeholder: string }[] = [
  { value: "cpId",         label: "CP ID / Signal ID",  placeholder: "e.g. INTG.1986320963, TSNS:4C-452, 4245.0.0.0" },
  { value: "room",         label: "Room",                placeholder: "e.g. 210" },
  { value: "fqLocation",   label: "fqLocation",          placeholder: "e.g. Medication Room Oak/Pine" },
  { value: "callType",     label: "Call Type",           placeholder: "e.g. Maintenance Call" },
  { value: "mqtt",         label: "MQTT Topic",          placeholder: "e.g. austco/events/activate" },
  { value: "controllerId", label: "Controller ID",       placeholder: "e.g. CCT-4A" },
];

function Page() {
  const { deviceId, alertId } = Route.useSearch();
  const [kind, setKind] = useState<TraceTargetKind>("cpId");
  const [value, setValue] = useState("");
  const [callType, setCallType] = useState("");
  const [fqLocation, setFqLocation] = useState("");
  const [mqttTopic, setMqttTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [usingCachedServices, setUsingCachedServices] = useState(false);

  useEffect(() => { setUsingCachedServices(!!loadServicesDiagnosis<ServicesDiagnosis>()); }, []);

  async function handleRun() {
    setError(null); setBusy(true); setResult(null);
    try {
      const siteConfig = loadSiteConfig();
      const cached = loadServicesDiagnosis<ServicesDiagnosis>();
      const r = await runTrace({
        target: { kind, value, callType, fqLocation, mqttTopic },
        siteConfig,
        services: cached?.services?.length ? undefined : siteConfig.services,
        serviceResults: cached?.services || [],
      });
      setResult(r);
      if ("ok" in r && !r.ok) setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const kindMeta = KINDS.find((k) => k.value === kind)!;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Forensics"
        title="Trace Signal Path"
        description="Wireshark for Austco events — trace a real signal end-to-end and find exactly where it breaks."
      />

      <TraceContextCard deviceId={deviceId} alertId={alertId} />

      <Card className="bg-card/70">
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-[200px_1fr_auto]">
            <div>
              <Label className="text-xs">Trace by</Label>
              <select value={kind} onChange={(e) => setKind(e.target.value as TraceTargetKind)}
                className={cn("mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm")}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">{kindMeta.label}</Label>
              <Input className="mt-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kindMeta.placeholder} />
            </div>
            <div className="flex items-end">
              <Button onClick={handleRun} disabled={busy || (!value && !fqLocation && !mqttTopic && !callType)} className="h-9">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
                Run Trace
              </Button>
            </div>
          </div>

          {(kind === "callType" || kind === "fqLocation" || kind === "mqtt") && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Call Type (optional)</Label>
                <Input className="mt-1" value={callType} onChange={(e) => setCallType(e.target.value)} placeholder="Maintenance Call" />
              </div>
              <div>
                <Label className="text-xs">fqLocation (optional)</Label>
                <Input className="mt-1" value={fqLocation} onChange={(e) => setFqLocation(e.target.value)} placeholder="Medication Room Oak/Pine" />
              </div>
              <div>
                <Label className="text-xs">MQTT Topic (optional)</Label>
                <Input className="mt-1" value={mqttTopic} onChange={(e) => setMqttTopic(e.target.value)} placeholder="austco/events/#" />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {usingCachedServices
                ? "Using cached service diagnosis as evidence. Re-run service diagnosis from Command Center to refresh."
                : "No cached service diagnosis. Trace will run a fresh diagnosis if services are configured."}
            </span>
            <span>Deterministic engine · AI does not decide root cause</span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-critical/40 bg-critical/5">
          <CardContent className="p-3 text-sm text-critical">{error}</CardContent>
        </Card>
      )}

      {result && "ok" in result && result.ok && (
        <>
          <TraceSignalPathPanel trace={result} />
          <div className="flex flex-wrap gap-2">
            <AiCommanderTrigger source="trace" mode="explain_on_site" context={{ trace: result }} label="Explain trace" />
            <AiCommanderTrigger source="trace" mode="evidence_challenge" context={{ trace: result }} label="Challenge this trace" />
          </div>
        </>
      )}
    </div>
  );
}
