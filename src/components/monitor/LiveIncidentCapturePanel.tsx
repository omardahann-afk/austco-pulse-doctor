import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, Square, FlagTriangleRight, Flag, Activity, Download, Brain } from "lucide-react";
import { toast } from "sonner";
import { useSiteConfigStore } from "@/stores/siteConfigStore";
import {
  liveCapture,
  type CaptureSession,
  type CaptureCounters,
  type DiagnosisResult,
  type SignalPathResult,
  type DeveloperPackage,
} from "@/lib/liveCaptureClient";
import { LiveCaptureResultPanel } from "./LiveCaptureResultPanel";

interface FormState {
  problemStatement: string;
  room: string;
  callpoint: string;
  expectedBehavior: string;
  actualBehavior: string;
  technicianNotes: string;
  selectedDeviceIds: string[];
}

const EMPTY: FormState = {
  problemStatement: "",
  room: "",
  callpoint: "",
  expectedBehavior: "",
  actualBehavior: "",
  technicianNotes: "",
  selectedDeviceIds: [],
};

function fmtElapsed(startIso: string | null | undefined, nowMs: number): string {
  if (!startIso) return "00:00";
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return "00:00";
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function StatusPill({ status }: { status: CaptureSession["status"] | "idle" }) {
  const cls: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    capturing: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    reproduction_active: "bg-rose-500/15 text-rose-400 border-rose-500/40 animate-pulse",
    stopped: "bg-amber-500/15 text-amber-400 border-amber-500/40",
    analyzing: "bg-primary/15 text-primary border-primary/40 animate-pulse",
    complete: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/40",
  };
  return (
    <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls[status] || cls.idle}`}>
      {status}
    </span>
  );
}

export function LiveIncidentCapturePanel() {
  const monitoredDevices = useSiteConfigStore((s) => s.monitoredDevices);
  const hydrate = useSiteConfigStore((s) => s.hydrateFromBackend);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [counters, setCounters] = useState<CaptureCounters | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [signalPath, setSignalPath] = useState<SignalPathResult | null>(null);
  const [developerPackage, setDeveloperPackage] = useState<DeveloperPackage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<number | null>(null);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const status = session?.status ?? "idle";
  const isLive = status === "capturing" || status === "reproduction_active";

  // Tick clock (1s) for elapsed timer.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Poll session every 2s while live or analyzing.
  useEffect(() => {
    if (!session?.sessionId) return;
    if (!isLive && status !== "analyzing") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await liveCapture.get(session.sessionId);
        if (r.session) setSession(r.session);
        if (r.counters) setCounters(r.counters);
      } catch {/* swallow */}
    }, 2000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [session?.sessionId, isLive, status]);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleDevice(id: string) {
    setForm((f) => ({
      ...f,
      selectedDeviceIds: f.selectedDeviceIds.includes(id)
        ? f.selectedDeviceIds.filter((x) => x !== id)
        : [...f.selectedDeviceIds, id],
    }));
  }

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    try { return await fn(); }
    catch (err) { toast.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`); return undefined; }
    finally { setBusy(null); }
  }

  async function startCapture() {
    if (!form.problemStatement.trim()) { toast.error("Problem statement is required"); return; }
    if (form.selectedDeviceIds.length === 0) { toast.error("Select at least one monitored device"); return; }
    const r = await withBusy("Start capture", () => liveCapture.start({
      problemStatement: form.problemStatement,
      room: form.room,
      callpoint: form.callpoint,
      expectedBehavior: form.expectedBehavior,
      actualBehavior: form.actualBehavior,
      technicianNotes: form.technicianNotes,
      devicesIncluded: form.selectedDeviceIds,
    }));
    if (r?.session) {
      setSession(r.session);
      setCounters(r.counters || null);
      setDiagnosis(null); setSignalPath(null); setDeveloperPackage(null);
      toast.success("Live capture started");
    }
  }

  async function markReproStarted() {
    if (!session) return;
    const r = await withBusy("Mark reproduction started", () => liveCapture.markReproStarted(session.sessionId));
    if (r?.session) { setSession(r.session); setCounters(r.counters || null); toast.success("Reproduction window opened"); }
  }
  async function markReproFinished() {
    if (!session) return;
    const r = await withBusy("Mark reproduction finished", () => liveCapture.markReproFinished(session.sessionId));
    if (r?.session) { setSession(r.session); setCounters(r.counters || null); toast.success("Reproduction window closed"); }
  }
  async function ingestNow() {
    if (!session) return;
    const r = await withBusy("Ingest logs", () => liveCapture.ingestLogs(session.sessionId, { lines: 200 }));
    if (r?.session) {
      setSession(r.session); setCounters(r.counters || null);
      toast.success(`Ingested ${r.ingested?.raw ?? 0} raw / ${r.ingested?.events ?? 0} events`);
    }
  }
  async function stopCapture() {
    if (!session) return;
    const r = await withBusy("Stop capture", () => liveCapture.stop(session.sessionId));
    if (r?.session) { setSession(r.session); setCounters(r.counters || null); toast.success("Capture stopped"); }
  }
  async function analyze() {
    if (!session) return;
    const r = await withBusy("Analyze", () => liveCapture.analyze(session.sessionId));
    if (r?.session) {
      setSession(r.session); setCounters(r.counters || null);
      if (r.diagnosis) setDiagnosis(r.diagnosis);
      if (r.signalPath) setSignalPath(r.signalPath);
      if (r.developerPackage) setDeveloperPackage(r.developerPackage);
      toast.success("Analysis complete");
    }
  }

  function reset() {
    setSession(null); setCounters(null); setDiagnosis(null); setSignalPath(null); setDeveloperPackage(null);
    setForm(EMPTY);
  }

  const elapsed = useMemo(() => fmtElapsed(session?.startedAt, now), [session?.startedAt, now]);
  const reproElapsed = useMemo(() => fmtElapsed(session?.reproductionStartedAt, now), [session?.reproductionStartedAt, now]);

  return (
    <div className="space-y-3">
      <Card className="border-2 border-rose-500/40 bg-gradient-to-b from-rose-500/5 to-card/40">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400">// BLACK-BOX FLIGHT RECORDER</div>
              <h2 className="text-base font-bold uppercase tracking-wide">Live Incident Capture</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Configure → Start Capture → Reproduce → Stop → Analyze. Every button calls a real endpoint and persists evidence on the agent.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              {session && (
                <Badge variant="outline" className="font-mono text-[10px]">session {session.sessionId.slice(-8)}</Badge>
              )}
              {session && status !== "capturing" && status !== "reproduction_active" && (
                <Button size="sm" variant="ghost" onClick={reset}>New capture</Button>
              )}
            </div>
          </div>

          {!session && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider">Problem being reproduced *</Label>
                <Textarea value={form.problemStatement} onChange={(e) => setField("problemStatement", e.target.value)} placeholder="e.g. Invalid callpoint burst on Ward 3" className="mt-1 min-h-16" />
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Room</Label>
                <Input value={form.room} onChange={(e) => setField("room", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Callpoint / device</Label>
                <Input value={form.callpoint} onChange={(e) => setField("callpoint", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Expected behavior</Label>
                <Textarea value={form.expectedBehavior} onChange={(e) => setField("expectedBehavior", e.target.value)} className="mt-1 min-h-12" />
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Actual behavior</Label>
                <Textarea value={form.actualBehavior} onChange={(e) => setField("actualBehavior", e.target.value)} className="mt-1 min-h-12" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider">Technician notes</Label>
                <Textarea value={form.technicianNotes} onChange={(e) => setField("technicianNotes", e.target.value)} className="mt-1 min-h-12" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider">Devices included * (from saved monitored devices)</Label>
                <div className="mt-2 grid max-h-48 gap-1.5 overflow-auto rounded-md border border-border/60 bg-card/60 p-2 sm:grid-cols-2">
                  {monitoredDevices.length === 0 && (
                    <div className="col-span-full p-2 text-[11.5px] text-muted-foreground">
                      No monitored devices yet. Add devices via the Quick Deploy tiles below.
                    </div>
                  )}
                  {monitoredDevices.map((d) => {
                    const checked = form.selectedDeviceIds.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                        <Checkbox checked={checked} onCheckedChange={() => toggleDevice(d.id)} />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium">{d.name || d.id}</div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{d.kind} · {d.host}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {session && (
            <div className="grid gap-3 md:grid-cols-4">
              <Stat label="Elapsed" value={elapsed} />
              <Stat label="Reproduction" value={session.reproductionStartedAt ? reproElapsed : "—"} highlight={status === "reproduction_active"} />
              <Stat label="Raw evidence" value={String(counters?.rawEvidenceCount ?? 0)} />
              <Stat label="Normalized events" value={String(counters?.normalizedEventCount ?? 0)} />
              <Stat label="Errors" value={String(counters?.errorCount ?? 0)} tone="danger" />
              <Stat label="Warnings" value={String(counters?.warningCount ?? 0)} tone="warn" />
              <Stat label="Affected callpoints" value={String(counters?.affectedCallpoints?.length ?? 0)} />
              <Stat label="Distinct event types" value={String(counters?.distinctEventTypes?.length ?? 0)} />
              <div className="md:col-span-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Affected appliances: {counters?.affectedAppliances?.length ? counters.affectedAppliances.join(", ") : "—"}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!session && (
              <Button onClick={startCapture} disabled={busy !== null}>
                <Play className="mr-1.5 h-4 w-4" /> Start Capture
              </Button>
            )}
            {session && status === "capturing" && (
              <Button onClick={markReproStarted} disabled={busy !== null} className="bg-rose-600 hover:bg-rose-700">
                <FlagTriangleRight className="mr-1.5 h-4 w-4" /> Mark Reproduction Started
              </Button>
            )}
            {session && status === "reproduction_active" && (
              <Button onClick={markReproFinished} disabled={busy !== null} variant="secondary">
                <Flag className="mr-1.5 h-4 w-4" /> Mark Reproduction Finished
              </Button>
            )}
            {session && isLive && (
              <Button onClick={ingestNow} disabled={busy !== null} variant="outline">
                <Download className="mr-1.5 h-4 w-4" /> Ingest Logs Now
              </Button>
            )}
            {session && (status === "capturing" || status === "reproduction_active") && (
              <Button onClick={stopCapture} disabled={busy !== null} variant="outline">
                <Square className="mr-1.5 h-4 w-4" /> Stop Capture
              </Button>
            )}
            {session && (status === "stopped" || status === "complete") && (
              <Button onClick={analyze} disabled={busy !== null}>
                <Brain className="mr-1.5 h-4 w-4" /> {status === "complete" ? "Re-analyze" : "Analyze Capture"}
              </Button>
            )}
            {busy && <span className="self-center font-mono text-[11px] text-muted-foreground"><Activity className="mr-1 inline h-3 w-3 animate-pulse" />{busy}…</span>}
          </div>
        </CardContent>
      </Card>

      {session && diagnosis && signalPath && developerPackage && (
        <LiveCaptureResultPanel
          session={session}
          diagnosis={diagnosis}
          signalPath={signalPath}
          developerPackage={developerPackage}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, highlight }: { label: string; value: string; tone?: "danger" | "warn"; highlight?: boolean }) {
  const valCls =
    tone === "danger" ? "text-rose-400" :
    tone === "warn" ? "text-amber-400" :
    "";
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-rose-500/50 bg-rose-500/10" : "border-border/50 bg-card/50"}`}>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg font-bold tabular-nums ${valCls}`}>{value}</div>
    </div>
  );
}