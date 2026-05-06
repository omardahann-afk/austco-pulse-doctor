import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Activity, AlertTriangle, ArrowRight, ClipboardCopy, Cog, Download,
  FlaskConical, GitBranch, History, Loader2, Microscope, Network, Radio,
  ShieldCheck, Sparkles,
} from "lucide-react";
import {
  evidenceLatest, autopilotListPlans,
  type DeepEvidence, type EvidenceContradiction, type AutopilotPlan,
} from "@/lib/agentClient";

export const Route = createFileRoute("/evidence/playback")({
  head: () => ({
    meta: [
      { title: "Evidence Playback Timeline — Tacera Doctor" },
      { name: "description", content: "Black-box flight recorder for Tacera/Austco systems — replay every layer of evidence in the order it was collected." },
      { property: "og:title", content: "Evidence Playback Timeline — Tacera Doctor" },
      { property: "og:description", content: "Replay how the system reached its conclusion: network, process, port, MQTT, config, contradictions, and downstream effects." },
    ],
  }),
  component: PlaybackPage,
});

/* ===================== Types ===================== */

type Layer =
  | "detection" | "network" | "process" | "port" | "mqtt" | "config" | "state"
  | "contradiction" | "rootCause" | "trace" | "autopilot";

type TimelineEvent = {
  id: string;
  ts: string;            // ISO
  layer: Layer;
  source: string;        // human label e.g. "deepEvidence.networkTruth"
  finding: string;
  detail?: string;
  confidence?: number;   // 0..1
  service?: string | null;
  cpId?: string | null;
  contradictionKind?: string | null;
  influencesRootCause: boolean;
  influencesTrace: boolean;
  influencesAutopilot: boolean;
  raw?: unknown;
};

/* ===================== Builder ===================== */

const LAYER_META: Record<Layer, { label: string; icon: React.ReactNode; tone: string }> = {
  detection:     { label: "Detection",     icon: <History className="h-3.5 w-3.5" />,        tone: "text-muted-foreground" },
  network:       { label: "Network",       icon: <Network className="h-3.5 w-3.5" />,        tone: "text-info" },
  process:       { label: "Process",       icon: <Activity className="h-3.5 w-3.5" />,       tone: "text-info" },
  port:          { label: "Port",          icon: <Network className="h-3.5 w-3.5" />,        tone: "text-info" },
  mqtt:          { label: "MQTT",          icon: <Radio className="h-3.5 w-3.5" />,          tone: "text-info" },
  config:        { label: "Config",        icon: <Cog className="h-3.5 w-3.5" />,            tone: "text-info" },
  state:         { label: "State",         icon: <Cog className="h-3.5 w-3.5" />,            tone: "text-muted-foreground" },
  contradiction: { label: "Contradiction", icon: <AlertTriangle className="h-3.5 w-3.5" />,  tone: "text-warning" },
  rootCause:     { label: "Root Cause",    icon: <GitBranch className="h-3.5 w-3.5" />,      tone: "text-insight" },
  trace:         { label: "Trace",         icon: <GitBranch className="h-3.5 w-3.5" />,      tone: "text-insight" },
  autopilot:     { label: "Autopilot",     icon: <ShieldCheck className="h-3.5 w-3.5" />,    tone: "text-success" },
};

const CONTRADICTION_TO_TRACE = new Set([
  "log_event_missing_on_mqtt", "mqtt_publish_no_ack",
  "service_running_no_port", "host_reachable_port_closed",
]);

function tsOrFallback(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function buildTimeline(evidence: DeepEvidence, plans: AutopilotPlan[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const detectedAt = evidence.collectedAt;

  // 1. Detection
  out.push({
    id: "detect",
    ts: detectedAt,
    layer: "detection",
    source: "deepEvidenceEngine",
    finding: `Evidence collection started — score ${Math.round(evidence.evidenceScore ?? 0)}%`,
    detail: `Targets: ${evidence.targets?.length ?? 0}. Mock: ${evidence.mock ? "yes" : "no"}.`,
    influencesRootCause: false, influencesTrace: false, influencesAutopilot: false,
  });

  // 2. Network truth — per target
  const netCollectedAt = tsOrFallback((evidence.networkTruth as { collectedAt?: string })?.collectedAt, detectedAt);
  for (const t of evidence.networkTruth?.targets || []) {
    const tt = t as Record<string, any>;
    const reachable = !!tt.ping?.reachable;
    const arpMac = tt.arp?.entry?.mac as string | undefined;
    const closed = (tt.tcpChecks || []).filter((c: any) => c && c.open === false && c.port !== 22);
    out.push({
      id: `net-${tt.name || tt.host}`,
      ts: netCollectedAt,
      layer: "network",
      source: "networkTruth",
      finding: `${tt.name || tt.host}: ${reachable ? `ping ok (${tt.ping?.avgLatencyMs ?? "?"}ms)` : "ping FAILED"}${arpMac ? `, ARP ${arpMac}` : ""}`,
      detail: closed.length ? `Closed ports: ${closed.map((c: any) => c.port).join(", ")}` : undefined,
      confidence: reachable ? 0.95 : 0.9,
      service: tt.name || null,
      influencesRootCause: false, influencesTrace: false, influencesAutopilot: false,
      raw: tt,
    });
  }

  // 3. Process truth
  const procCollectedAt = tsOrFallback((evidence.processTruth as { collectedAt?: string })?.collectedAt, detectedAt);
  for (const s of evidence.processTruth?.services || []) {
    const ss = s as Record<string, any>;
    if (ss.sshConnected === false) {
      out.push({
        id: `proc-${ss.name}`, ts: procCollectedAt, layer: "process", source: "processTruth",
        finding: `${ss.name}: SSH unreachable — process truth unavailable`,
        confidence: 0.6, service: ss.name || null,
        influencesRootCause: false, influencesTrace: false, influencesAutopilot: false, raw: ss,
      });
      continue;
    }
    out.push({
      id: `proc-${ss.name}`, ts: procCollectedAt, layer: "process", source: "processTruth",
      finding: `${ss.name}: ${ss.unit ? `${ss.unit} → ${ss.isActive || "unknown"}` : "no systemd unit detected"}`,
      detail: (ss.issues || []).map((i: any) => `${i.kind}: ${i.detail}`).join(" · ") || undefined,
      confidence: 0.9, service: ss.name || null,
      influencesRootCause: false, influencesTrace: false, influencesAutopilot: false, raw: ss,
    });
  }

  // 4. Port truth
  const portCollectedAt = tsOrFallback((evidence.portTruth as { collectedAt?: string })?.collectedAt, detectedAt);
  for (const s of evidence.portTruth?.services || []) {
    const ss = s as Record<string, any>;
    const checks = (ss.portChecks || []) as Array<any>;
    const summary = checks.map((c) => `:${c.port} ${c.listening ? "open" : "silent"}`).join(", ") || "no port checks";
    out.push({
      id: `port-${ss.name}`, ts: portCollectedAt, layer: "port", source: "portTruth",
      finding: `${ss.name}: ${summary}`,
      detail: checks.filter((c) => c.expected && c.listening && c.expectedProcOk === false)
        .map((c) => `port ${c.port} owned by ${(c.owners || []).map((o: any) => o.name).join(",") || "?"}`).join(" · ") || undefined,
      confidence: 0.9, service: ss.name || null,
      influencesRootCause: false, influencesTrace: false, influencesAutopilot: false, raw: ss,
    });
  }

  // 5. MQTT truth
  if (evidence.mqttTruth?.available) {
    out.push({
      id: "mqtt", ts: detectedAt, layer: "mqtt", source: "mqttTruth",
      finding: `MQTT tap saw ${evidence.mqttTruth.eventCount ?? 0} events${evidence.mqttTruth.silence ? " — silent window" : ""}`,
      detail: [
        evidence.mqttTruth.observedCpIds?.length ? `CPs: ${evidence.mqttTruth.observedCpIds.slice(0, 8).join(", ")}` : null,
        evidence.mqttTruth.missingAcks?.length ? `Missing ACKs: ${evidence.mqttTruth.missingAcks.length}` : null,
      ].filter(Boolean).join(" · ") || undefined,
      confidence: 0.85,
      influencesRootCause: false, influencesTrace: false, influencesAutopilot: false, raw: evidence.mqttTruth,
    });
  } else {
    out.push({
      id: "mqtt", ts: detectedAt, layer: "mqtt", source: "mqttTruth",
      finding: `MQTT tap unavailable (${evidence.mqttTruth?.reason || "no session"})`,
      confidence: 0.4,
      influencesRootCause: false, influencesTrace: false, influencesAutopilot: false,
    });
  }

  // 6. Config truth
  const cfgCollectedAt = tsOrFallback((evidence.configTruth as { collectedAt?: string })?.collectedAt, detectedAt);
  out.push({
    id: "config", ts: cfgCollectedAt, layer: "config", source: "configTruth",
    finding: `Site config: ${Object.entries(evidence.configTruth?.counts || {}).map(([k, v]) => `${k}=${v}`).join(", ") || "empty"}`,
    detail: (evidence.configTruth?.issues || []).map((i) => `${i.kind}${i.target ? ` · ${i.target}` : ""}: ${i.detail}`).join(" · ") || undefined,
    confidence: 0.95,
    influencesRootCause: !!(evidence.configTruth?.unknownCpIds?.length),
    influencesTrace: !!(evidence.configTruth?.unknownCpIds?.length),
    influencesAutopilot: false,
    cpId: evidence.configTruth?.unknownCpIds?.[0] || null,
    raw: evidence.configTruth,
  });

  // 7. Contradictions
  const rcSignalKinds = new Set((evidence.rootCauseSignals || []).map((s) => s.signal));
  const finishedAt = evidence.finishedAt || detectedAt;
  for (const c of evidence.contradictions || []) {
    const inflRoot = rcSignalKinds.has(c.kind);
    const inflTrace = CONTRADICTION_TO_TRACE.has(c.kind);
    out.push({
      id: `contra-${c.kind}-${c.target || ""}`,
      ts: finishedAt,
      layer: "contradiction",
      source: `${c.sourceA.layer} ⟂ ${c.sourceB.layer}`,
      finding: `${c.kind} — ${c.why}`,
      detail: `A: ${c.sourceA.said}\nB: ${c.sourceB.said}${c.nextCheck ? `\nNext: ${c.nextCheck}` : ""}`,
      confidence: c.confidence,
      service: c.target || null,
      contradictionKind: c.kind,
      influencesRootCause: inflRoot,
      influencesTrace: inflTrace,
      influencesAutopilot: false, // resolved below when we look at plans
      raw: c,
    });
  }

  // 8. Root-cause signals (which rules fired)
  for (const s of evidence.rootCauseSignals || []) {
    out.push({
      id: `rc-${s.signal}-${s.target || ""}`,
      ts: finishedAt,
      layer: "rootCause",
      source: "rootCauseEngine",
      finding: `Root-cause signal '${s.signal}' (layer: ${s.layer})`,
      detail: s.message,
      confidence: s.confidence,
      service: s.target || null,
      contradictionKind: s.signal,
      influencesRootCause: true,
      influencesTrace: false,
      influencesAutopilot: false,
      raw: s,
    });
  }

  // 9. Trace signals (which trace nodes flipped)
  for (const s of evidence.traceSignals || []) {
    out.push({
      id: `trace-${s.kind}-${s.target || ""}`,
      ts: finishedAt,
      layer: "trace",
      source: "traceEngine",
      finding: `Trace break attributed to '${s.kind}' (layer: ${s.break})`,
      detail: (s.evidence || []).join(" · "),
      confidence: 0.85,
      service: s.target || null,
      contradictionKind: s.kind,
      influencesRootCause: false,
      influencesTrace: true,
      influencesAutopilot: false,
      raw: s,
    });
  }

  // 10. Autopilot plans whose Deep Evidence collectedAt matches this evidence
  const matchingPlans = (plans || []).filter((p) =>
    p.deepEvidenceCollectedAt && p.deepEvidenceCollectedAt === evidence.collectedAt
  );
  for (const p of matchingPlans) {
    const contraKinds = (p.contradictions || []).map((c) => c.kind).join(", ");
    out.push({
      id: `auto-${p.planId}`,
      ts: p.createdAt,
      layer: "autopilot",
      source: "autopilotEngine",
      finding: `Plan generated for ${p.serviceName} — ${p.rootCause}${p.mockEvidence ? " [MOCK — execution blocked]" : ""}`,
      detail: `issueType=${p.issueType} · risk=${p.riskLevel} · conf=${(p.confidence * 100).toFixed(0)}%${contraKinds ? ` · contradictions: ${contraKinds}` : ""}`,
      confidence: p.confidence,
      service: p.serviceName || null,
      influencesRootCause: false,
      influencesTrace: false,
      influencesAutopilot: true,
      raw: p,
    });
    // Mark contradictions that influenced this plan
    for (const c of p.contradictions || []) {
      const target = c.target || "";
      const idx = out.findIndex((e) => e.layer === "contradiction" && e.contradictionKind === c.kind && (e.service || "") === target);
      if (idx >= 0) out[idx].influencesAutopilot = true;
    }
  }

  // Sort: by timestamp ascending; within same ts keep insertion order via stable sort.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = new Date(a.e.ts).getTime();
      const tb = new Date(b.e.ts).getTime();
      if (ta !== tb) return ta - tb;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/* ===================== Component ===================== */

function PlaybackPage() {
  const [evidence, setEvidence] = useState<DeepEvidence | null>(null);
  const [plans, setPlans] = useState<AutopilotPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [serviceFilter, setServiceFilter] = useState("");
  const [cpFilter, setCpFilter] = useState("");
  const [layerFilters, setLayerFilters] = useState<Set<Layer>>(new Set());
  const [onlyContradictions, setOnlyContradictions] = useState(false);
  const [onlyRootCauseInfluencing, setOnlyRootCauseInfluencing] = useState(false);
  const [onlyAutopilotInfluencing, setOnlyAutopilotInfluencing] = useState(false);

  const [aiPromptCopied, setAiPromptCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true); setError(null);
      try {
        const [eRes, pRes] = await Promise.all([evidenceLatest(), autopilotListPlans(50)]);
        if ("ok" in eRes && eRes.ok) setEvidence(eRes.evidence);
        else setError(("message" in eRes && eRes.message) || "No Deep Evidence collected yet.");
        if ("ok" in pRes && pRes.ok) setPlans(pRes.plans);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally { setLoading(false); }
    })();
  }, []);

  const allEvents = useMemo(() => evidence ? buildTimeline(evidence, plans) : [], [evidence, plans]);

  const events = useMemo(() => {
    return allEvents.filter((e) => {
      if (layerFilters.size > 0 && !layerFilters.has(e.layer)) return false;
      if (serviceFilter && !(e.service || "").toLowerCase().includes(serviceFilter.toLowerCase())) return false;
      if (cpFilter && !(e.cpId || "").toLowerCase().includes(cpFilter.toLowerCase())) return false;
      if (onlyContradictions && e.layer !== "contradiction") return false;
      if (onlyRootCauseInfluencing && !e.influencesRootCause) return false;
      if (onlyAutopilotInfluencing && !e.influencesAutopilot) return false;
      return true;
    });
  }, [allEvents, layerFilters, serviceFilter, cpFilter, onlyContradictions, onlyRootCauseInfluencing, onlyAutopilotInfluencing]);

  function toggleLayer(l: Layer) {
    setLayerFilters((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l); else next.add(l);
      return next;
    });
  }

  function buildSummaryText(): string {
    if (!evidence) return "";
    const lines: string[] = [];
    lines.push(`# Evidence Playback Timeline`);
    lines.push(`Collected: ${evidence.collectedAt}`);
    lines.push(`Score: ${Math.round(evidence.evidenceScore ?? 0)}%`);
    if (evidence.mock) lines.push(`Source: DEV MOCK (${evidence.mockTag || "mock"})`);
    lines.push(`Events shown: ${events.length} / ${allEvents.length}`);
    lines.push("");
    for (const e of events) {
      const flags = [
        e.influencesRootCause ? "→RC" : "",
        e.influencesTrace ? "→Trace" : "",
        e.influencesAutopilot ? "→Auto" : "",
      ].filter(Boolean).join(" ");
      lines.push(`- [${e.ts}] (${LAYER_META[e.layer].label}) ${e.finding}${e.confidence != null ? ` [conf ${(e.confidence * 100).toFixed(0)}%]` : ""}${flags ? ` {${flags}}` : ""}`);
      if (e.detail) lines.push(`    ${e.detail.replace(/\n/g, "\n    ")}`);
    }
    return lines.join("\n");
  }

  async function copySummary() {
    const t = buildSummaryText();
    await navigator.clipboard.writeText(t);
    setAiPromptCopied(false);
  }

  function exportJson() {
    if (!evidence) return;
    const blob = new Blob([JSON.stringify({
      meta: {
        collectedAt: evidence.collectedAt,
        finishedAt: evidence.finishedAt,
        evidenceScore: evidence.evidenceScore,
        mock: !!evidence.mock,
        mockTag: evidence.mockTag || null,
      },
      events,
      filters: {
        service: serviceFilter || null,
        cpId: cpFilter || null,
        layers: Array.from(layerFilters),
        onlyContradictions, onlyRootCauseInfluencing, onlyAutopilotInfluencing,
      },
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `evidence-playback-${evidence.collectedAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyForCopilot() {
    const summary = buildSummaryText();
    const prompt = [
      "You are an Austco/Tacera systems expert. Below is a read-only Evidence Playback Timeline.",
      "Explain in plain English how the system reached its conclusion, calling out:",
      "  1. The earliest signal that mattered",
      "  2. Which contradictions changed the conclusion",
      "  3. Why the chosen Root Cause is consistent with the evidence",
      "  4. What a technician should verify next",
      "Do not invent data not present below.",
      "",
      summary,
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    setAiPromptCopied(true);
    setTimeout(() => setAiPromptCopied(false), 3000);
  }

  const ageMs = evidence?.collectedAt ? Date.now() - new Date(evidence.collectedAt).getTime() : null;
  const stale = ageMs !== null && ageMs > 15 * 60 * 1000;
  const ageLabel = ageMs == null ? "—" : ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s ago` : `${Math.round(ageMs / 60_000)}m ago`;
  const isMock = !!evidence?.mock;

  const counts = useMemo(() => ({
    all: allEvents.length,
    contra: allEvents.filter((e) => e.layer === "contradiction").length,
    rc: allEvents.filter((e) => e.influencesRootCause).length,
    trace: allEvents.filter((e) => e.influencesTrace).length,
    auto: allEvents.filter((e) => e.influencesAutopilot).length,
  }), [allEvents]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <History className="h-6 w-6 text-info" /> Evidence Playback Timeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Black-box flight recorder. Replays exactly how Deep Evidence reached its conclusion — and which Root Cause, Trace, and Autopilot decisions changed because of it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" asChild><Link to="/evidence"><Microscope className="h-4 w-4" /> Deep Evidence</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/diagnosis">Root Cause</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/trace">Trace</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/autopilot">Autopilot</Link></Button>
        </div>
      </header>

      {error && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
          <Button size="sm" variant="outline" asChild className="ml-auto"><Link to="/evidence">Collect Deep Evidence</Link></Button>
        </CardContent></Card>
      )}

      {isMock && (
        <Card className="border-warning/60 bg-warning/10">
          <CardContent className="flex items-center gap-2 p-3 text-sm text-warning">
            <FlaskConical className="h-4 w-4" />
            <strong>DEV MOCK evidence</strong> — timeline shown for QA. Autopilot plans built from mock are blocked from execution.
            {evidence?.mockTag && <span className="text-xs text-muted-foreground">· {evidence.mockTag}</span>}
          </CardContent>
        </Card>
      )}

      {stale && evidence && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-3 text-xs text-warning">
            ⚠ Deep Evidence is stale ({ageLabel}) — collect fresh evidence before treating this timeline as current truth.
          </CardContent>
        </Card>
      )}

      {/* Summary stats */}
      <section className="grid gap-3 md:grid-cols-5">
        <Stat label="Total events" value={String(counts.all)} />
        <Stat label="Contradictions" value={String(counts.contra)} tone={counts.contra ? "warn" : "ok"} />
        <Stat label="Influenced Root Cause" value={String(counts.rc)} tone={counts.rc ? "info" : undefined} />
        <Stat label="Influenced Trace" value={String(counts.trace)} tone={counts.trace ? "info" : undefined} />
        <Stat label="Influenced Autopilot" value={String(counts.auto)} tone={counts.auto ? "ok" : undefined} />
      </section>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-[11px]">Service / target</Label>
              <Input className="h-8 w-44" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} placeholder="e.g. INGA-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">CP ID</Label>
              <Input className="h-8 w-32" value={cpFilter} onChange={(e) => setCpFilter(e.target.value)} placeholder="e.g. CP-204" />
            </div>
            <FilterToggle label="Contradictions only" checked={onlyContradictions} onChange={setOnlyContradictions} />
            <FilterToggle label="Root-cause influencing" checked={onlyRootCauseInfluencing} onChange={setOnlyRootCauseInfluencing} />
            <FilterToggle label="Autopilot influencing" checked={onlyAutopilotInfluencing} onChange={setOnlyAutopilotInfluencing} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={copySummary} disabled={!evidence}>
                <ClipboardCopy className="h-4 w-4" /> Copy summary
              </Button>
              <Button size="sm" variant="outline" onClick={exportJson} disabled={!evidence}>
                <Download className="h-4 w-4" /> Export JSON
              </Button>
              <Button size="sm" onClick={copyForCopilot} disabled={!evidence}>
                <Sparkles className="h-4 w-4" /> {aiPromptCopied ? "Copied!" : "Send to AI Copilot"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(LAYER_META) as Layer[]).map((l) => {
              const active = layerFilters.has(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLayer(l)}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${
                    active ? "border-info bg-info/10 text-info" : "border-border bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {LAYER_META[l].icon}{LAYER_META[l].label}
                </button>
              );
            })}
            {layerFilters.size > 0 && (
              <button type="button" onClick={() => setLayerFilters(new Set())} className="ml-2 text-[11px] text-muted-foreground underline">clear layers</button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      {loading ? (
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…</CardContent></Card>
      ) : !evidence ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">
          <strong>No evidence to play back yet.</strong> Collect Deep Evidence first, or load a mock scenario from the Deep Evidence page.
        </CardContent></Card>
      ) : events.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No events match the current filters.</CardContent></Card>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-border/60 pl-5">
          {events.map((e) => <TimelineRow key={e.id} event={e} />)}
        </ol>
      )}

      <div className="text-[11px] text-muted-foreground">
        <strong>Read-only.</strong> This page never executes SSH, never edits config, never triggers remediation, and never uses ServiceNow.
      </div>
    </div>
  );
}

/* ===================== Subcomponents ===================== */

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "info" }) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : tone === "info" ? "text-info" : "text-foreground";
  return (
    <Card><CardContent className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </CardContent></Card>
  );
}

function FilterToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-xs">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}

function TimelineRow({ event: e }: { event: TimelineEvent }) {
  const meta = LAYER_META[e.layer];
  return (
    <li className="relative">
      <span className={`absolute -left-[27px] top-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-muted ${meta.tone}`}>
        {meta.icon}
      </span>
      <Card>
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
            <span className="font-mono text-muted-foreground">{new Date(e.ts).toLocaleString()}</span>
            <span className="text-muted-foreground">· source: {e.source}</span>
            {e.confidence != null && <span className="text-muted-foreground">· conf {(e.confidence * 100).toFixed(0)}%</span>}
            {e.service && <span className="text-muted-foreground">· {e.service}</span>}
            {e.cpId && <span className="text-muted-foreground">· CP {e.cpId}</span>}
            <div className="ml-auto flex items-center gap-1">
              {e.influencesRootCause && <InfluenceBadge label="→ Root Cause" tone="insight" />}
              {e.influencesTrace && <InfluenceBadge label="→ Trace" tone="insight" />}
              {e.influencesAutopilot && <InfluenceBadge label="→ Autopilot" tone="success" />}
            </div>
          </div>
          <div className="text-sm">{e.finding}</div>
          {e.detail && <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{e.detail}</pre>}
        </CardContent>
      </Card>
    </li>
  );
}

function InfluenceBadge({ label, tone }: { label: string; tone: "insight" | "success" }) {
  const cls = tone === "success"
    ? "border-success/40 bg-success/10 text-success"
    : "border-insight/40 bg-insight/10 text-insight";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      <ArrowRight className="h-3 w-3" /> {label}
    </span>
  );
}
