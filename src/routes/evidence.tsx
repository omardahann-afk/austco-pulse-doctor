import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Microscope, AlertTriangle, ShieldCheck, Radio, Network, Activity, Cog, GitBranch, FlaskConical, X, ArrowRight, History } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  evidenceCollect, evidenceLatest,
  mqttTapStart, mqttTapStop, mqttTapEvents,
  evidenceMockScenarios, evidenceMockSet, evidenceMockClear,
  type DeepEvidence, type EvidenceScenario,
} from "@/lib/agentClient";
import { loadSiteConfig } from "@/lib/siteConfig";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "Deep Evidence — Tacera Doctor" },
      { name: "description", content: "Read-only evidence X-ray across network, process, port, MQTT, and configuration layers, with contradiction detection." },
      { property: "og:title", content: "Deep Evidence — Tacera Doctor" },
      { property: "og:description", content: "Evidence X-ray for Austco systems with contradiction detection across layers." },
    ],
  }),
  component: EvidencePage,
});

function EvidencePage() {
  const [evidence, setEvidence] = useState<DeepEvidence | null>(null);
  const [busy, setBusy] = useState<"" | "collect" | "mqtt-start" | "mqtt-stop" | "mqtt-poll" | "mock-set" | "mock-clear">("");
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<EvidenceScenario[]>([]);

  // MQTT tap state
  const [mqttSessionId, setMqttSessionId] = useState<string | null>(null);
  const [mqttExpiresAt, setMqttExpiresAt] = useState<string | null>(null);
  const [mqttForm, setMqttForm] = useState({
    brokerHost: "", brokerPort: 1883, tls: false, username: "", password: "",
    topic: "#", durationSeconds: 30, ackTopic: "",
  });
  const [mqttEvents, setMqttEvents] = useState<Array<{ ts: string; topic: string; payloadSummary: string; correlations: Record<string, string> }>>([]);

  useEffect(() => {
    void (async () => {
      const r = await evidenceLatest();
      if ("ok" in r && r.ok) setEvidence(r.evidence);
    })();
    void (async () => {
      const r = await evidenceMockScenarios();
      if ("ok" in r && r.ok) setScenarios(r.scenarios);
    })();
  }, []);

  async function collect() {
    setBusy("collect"); setError(null);
    try {
      const cfg = loadSiteConfig();
      const r = await evidenceCollect({ siteConfig: cfg, services: cfg.services, mqttSessionId });
      if ("ok" in r && r.ok) setEvidence(r.evidence);
      else setError(("message" in r && r.message) || "Collection failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  async function startTap() {
    if (!mqttForm.brokerHost) { setError("Broker host required"); return; }
    setBusy("mqtt-start"); setError(null);
    try {
      const r = await mqttTapStart({ ...mqttForm, ackTopic: mqttForm.ackTopic || undefined });
      if (r.ok) { setMqttSessionId(r.sessionId); setMqttExpiresAt(r.expiresAt); setMqttEvents([]); }
      else setError(r.message || "MQTT tap failed to start");
    } finally { setBusy(""); }
  }

  async function stopTap() {
    if (!mqttSessionId) return;
    setBusy("mqtt-stop");
    await mqttTapStop(mqttSessionId);
    setMqttSessionId(null); setMqttExpiresAt(null);
    setBusy("");
  }

  async function pollTap() {
    if (!mqttSessionId) return;
    setBusy("mqtt-poll");
    const r = await mqttTapEvents(mqttSessionId);
    if ("ok" in r && r.ok) setMqttEvents(r.session.events);
    setBusy("");
  }

  async function loadMock(id: string) {
    setBusy("mock-set"); setError(null);
    try {
      const r = await evidenceMockSet(id);
      if ("ok" in r && r.ok) setEvidence(r.evidence);
      else setError(("message" in r && r.message) || "Mock load failed");
    } finally { setBusy(""); }
  }

  async function clearMock() {
    setBusy("mock-clear"); setError(null);
    try {
      await evidenceMockClear();
      setEvidence(null);
    } finally { setBusy(""); }
  }

  const score = evidence?.evidenceScore ?? 0;
  const contradictions = evidence?.contradictions ?? [];
  const cfg = useMemo(() => (typeof window !== "undefined" ? loadSiteConfig() : null), []);
  const ageMs = evidence?.collectedAt ? Date.now() - new Date(evidence.collectedAt).getTime() : null;
  const stale = ageMs !== null && ageMs > 15 * 60 * 1000;
  const isMock = !!evidence?.mock;
  const ageLabel = ageMs == null ? "—" : ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s ago` : `${Math.round(ageMs / 60_000)}m ago`;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Microscope className="h-6 w-6 text-info" /> Deep Evidence</h1>
          <p className="text-sm text-muted-foreground">Read-only X-ray across network, process, ports, MQTT, and configuration. Contradictions feed Root Cause, Trace, and Autopilot.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={collect} disabled={!!busy}>
            {busy === "collect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
            Collect Deep Evidence
          </Button>
          <Button size="sm" variant="outline" asChild><Link to="/autopilot">Autopilot</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/trace">Trace</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/diagnosis">Root Cause</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/evidence/playback"><History className="h-4 w-4" /> Playback</Link></Button>
        </div>
      </header>

      {error && <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{error}</CardContent></Card>}

      {isMock && (
        <Card className="border-warning/60 bg-warning/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="flex items-center gap-2 text-warning"><FlaskConical className="h-4 w-4" />
              <strong>DEV MOCK — not real site data.</strong>
              <span className="text-xs text-muted-foreground">{evidence?.mockTag} · {evidence?.mockDescription}</span>
            </div>
            <Button size="sm" variant="outline" onClick={clearMock} disabled={!!busy}>
              <X className="h-3.5 w-3.5" /> Clear mock
            </Button>
          </CardContent>
        </Card>
      )}

      {stale && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-3 text-xs text-warning">
            ⚠ Deep Evidence stale ({ageLabel}) — collect again before remediation.
          </CardContent>
        </Card>
      )}

      {/* 1. Controls + summary */}
      <section className="grid gap-3 md:grid-cols-4">
        <SummaryStat icon={<Activity className="h-4 w-4" />} label="Evidence score" value={`${Math.round(score)}%`} />
        <SummaryStat icon={<AlertTriangle className="h-4 w-4" />} label="Contradictions" value={String(contradictions.length)} tone={contradictions.length > 0 ? "warn" : "ok"} />
        <SummaryStat icon={<Network className="h-4 w-4" />} label="Targets" value={String(evidence?.targets?.length ?? 0)} />
        <SummaryStat icon={<Radio className="h-4 w-4" />} label="MQTT tap" value={evidence?.mqttTruth?.available ? `live (${evidence.mqttTruth.eventCount ?? 0})` : "off"} />
      </section>

      {/* DEV mock scenarios */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <FlaskConical className="h-4 w-4" /> DEV mock scenarios
        </h2>
        <Card>
          <CardContent className="space-y-2 p-3 text-xs">
            <p className="text-muted-foreground">
              Inject synthetic Deep Evidence to verify Root Cause / Trace / Autopilot behave correctly.
              Mock evidence is tagged <strong>DEV MOCK</strong> and Autopilot is permanently blocked from executing remediation against it.
            </p>
            <div className="flex flex-wrap gap-2">
              {scenarios.map((s) => (
                <Button key={s.id} size="sm" variant="outline" disabled={!!busy} onClick={() => loadMock(s.id)}>
                  {busy === "mock-set" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                  {s.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Debug panel */}
      {evidence && <DebugPanel evidence={evidence} ageLabel={ageLabel} />}

      {!evidence ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">
          <strong>Deep Evidence not available.</strong> Click <strong>Collect Deep Evidence</strong> to gather read-only truth from the configured services, or load a DEV mock scenario above.
          {cfg && cfg.services.length === 0 && <> No services are configured — add some on the Command Center.</>}
        </CardContent></Card>
      ) : (
        <>
          {/* 2. Evidence Matrix */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Evidence matrix</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <LayerCard title="Network truth" icon={<Network className="h-4 w-4" />} items={(evidence.networkTruth.targets || []).map((t: any) => ({
                label: t.name || t.host || "target",
                badges: [
                  t.ping?.reachable
                    ? { label: `ping ${t.ping?.avgLatencyMs ?? "?"}ms`, tone: "ok" as const }
                    : { label: "ping fail", tone: "fail" as const },
                  t.arp?.entry?.mac
                    ? { label: "arp seen", tone: "ok" as const }
                    : { label: "arp absent", tone: "warn" as const },
                ],
                lines: (t.tcpChecks || []).map((p: any) => `tcp/${p.port} ${p.open ? "open" : `closed${p.error ? " (" + p.error + ")" : ""}`}`),
              }))} />
              <LayerCard title="Process truth" icon={<Activity className="h-4 w-4" />} items={(evidence.processTruth.services || []).map((s: any) => ({
                label: s.name || s.host || "service",
                badges: [
                  s.sshConnected === false
                    ? { label: "ssh unreachable", tone: "warn" as const }
                    : s.isActive === "active"
                      ? { label: "systemd active", tone: "ok" as const }
                      : s.isActive
                        ? { label: `systemd ${s.isActive}`, tone: "fail" as const }
                        : { label: "no systemd unit", tone: "muted" as const },
                ],
                lines: [s.unit ? `unit: ${s.unit}` : null, ...((s.issues || []).map((i: any) => `${i.kind}: ${i.detail}`))].filter(Boolean) as string[],
              }))} />
              <LayerCard title="Port truth" icon={<Network className="h-4 w-4" />} items={(evidence.portTruth.services || []).map((s: any) => ({
                label: s.name || s.host || "service",
                badges: s.sshConnected === false ? [{ label: "ssh unreachable", tone: "warn" as const }] : [],
                lines: (s.portChecks || []).map((p: any) => `:${p.port} ${p.listening ? "listening" : "silent"}${(p.owners || []).length ? " — " + p.owners.map((o: any) => o.name).join(",") : ""}${p.expected && p.expectedProcOk === false && p.listening ? " ⚠ wrong owner" : ""}`),
              }))} />
              <LayerCard title="Config truth" icon={<Cog className="h-4 w-4" />} items={[{
                label: "Site config",
                badges: Object.entries(evidence.configTruth.counts || {}).map(([k, v]) => ({ label: `${k}: ${v}`, tone: "muted" as const })),
                lines: (evidence.configTruth.issues || []).map((i: any) => `${i.kind}${i.target ? " · " + i.target : ""} — ${i.detail}`),
              }]} />
              <LayerCard title="MQTT truth" icon={<Radio className="h-4 w-4" />} items={[{
                label: evidence.mqttTruth.available ? "Live tap" : "Unavailable",
                badges: evidence.mqttTruth.available
                  ? [
                      { label: `${evidence.mqttTruth.eventCount ?? 0} events`, tone: "ok" as const },
                      evidence.mqttTruth.silence ? { label: "silence", tone: "warn" as const } : null,
                    ].filter(Boolean) as any
                  : [{ label: evidence.mqttTruth.reason || "no creds", tone: "muted" as const }],
                lines: [
                  ...(evidence.mqttTruth.observedCpIds || []).slice(0, 5).map((id) => `cpId ${id}`),
                  ...(evidence.mqttTruth.missingAcks || []).map((m) => `missing ack: ${m}`),
                ],
              }]} />
              <LayerCard title="State truth" icon={<Cog className="h-4 w-4" />} items={[{
                label: evidence.stateTruth.available ? "Available" : "Limited",
                badges: [],
                lines: [evidence.stateTruth.note],
              }]} />
            </div>
          </section>

          {/* 3. Contradictions */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contradictions</h2>
            {contradictions.length === 0 ? (
              <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-success"><ShieldCheck className="h-4 w-4" /> No contradictions across collected layers.</CardContent></Card>
            ) : contradictions.map((c, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-warning text-warning">{c.kind}</Badge>
                    <span className="text-xs text-muted-foreground">likely layer: {c.likelyLayer}</span>
                    <span className="text-xs text-muted-foreground">conf {(c.confidence * 100).toFixed(0)}%</span>
                    {c.target && <span className="text-xs text-muted-foreground">target {c.target}</span>}
                  </div>
                  <div className="text-sm">{c.why}</div>
                  <div className="text-xs text-muted-foreground">
                    <strong>{c.sourceA.layer}:</strong> {c.sourceA.said}
                    <br />
                    <strong>{c.sourceB.layer}:</strong> {c.sourceB.said}
                  </div>
                  {c.nextCheck && <div className="text-xs"><strong>Suggested next check:</strong> {c.nextCheck}</div>}
                </CardContent>
              </Card>
            ))}
          </section>

          {/* 4. Feed-to integrations */}
          <section className="grid gap-3 md:grid-cols-3">
            <FeedCard title="Feed to Root Cause" icon={<GitBranch className="h-4 w-4" />} count={evidence.rootCauseSignals.length} to="/diagnosis" preview={evidence.rootCauseSignals.slice(0, 3).map((s) => s.message)} />
            <FeedCard title="Feed to Trace" icon={<GitBranch className="h-4 w-4" />} count={evidence.traceSignals.length} to="/trace" preview={evidence.traceSignals.slice(0, 3).map((s) => `${s.kind} · ${s.target ?? ""}`)} />
            <FeedCard title="Feed to Autopilot" icon={<ShieldCheck className="h-4 w-4" />} count={contradictions.length} to="/autopilot" preview={contradictions.slice(0, 3).map((c) => c.why)} />
          </section>
        </>
      )}

      {/* 5. MQTT live tap controls */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">MQTT live tap (read-only subscribe)</h2>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Broker host"><Input value={mqttForm.brokerHost} onChange={(e) => setMqttForm({ ...mqttForm, brokerHost: e.target.value })} placeholder="mqtt.local" /></Field>
              <Field label="Port"><Input type="number" value={mqttForm.brokerPort} onChange={(e) => setMqttForm({ ...mqttForm, brokerPort: Number(e.target.value) })} /></Field>
              <Field label="Topic (wildcard ok)"><Input value={mqttForm.topic} onChange={(e) => setMqttForm({ ...mqttForm, topic: e.target.value })} /></Field>
              <Field label="Username (optional)"><Input value={mqttForm.username} onChange={(e) => setMqttForm({ ...mqttForm, username: e.target.value })} /></Field>
              <Field label="Password (optional)"><Input type="password" value={mqttForm.password} onChange={(e) => setMqttForm({ ...mqttForm, password: e.target.value })} /></Field>
              <Field label="Duration (s)"><Input type="number" value={mqttForm.durationSeconds} onChange={(e) => setMqttForm({ ...mqttForm, durationSeconds: Number(e.target.value) })} /></Field>
              <Field label="ACK topic (optional)"><Input value={mqttForm.ackTopic} onChange={(e) => setMqttForm({ ...mqttForm, ackTopic: e.target.value })} /></Field>
              <Field label="TLS">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mqttForm.tls} onChange={(e) => setMqttForm({ ...mqttForm, tls: e.target.checked })} /> use TLS</label>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!mqttSessionId ? (
                <Button size="sm" onClick={startTap} disabled={!!busy}>{busy === "mqtt-start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Start tap</Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={pollTap} disabled={!!busy}>Poll events ({mqttEvents.length})</Button>
                  <Button size="sm" variant="destructive" onClick={stopTap} disabled={!!busy}>Stop tap</Button>
                  <span className="text-xs text-muted-foreground">session {mqttSessionId} · expires {mqttExpiresAt && new Date(mqttExpiresAt).toLocaleTimeString()}</span>
                </>
              )}
            </div>
            {mqttEvents.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px]">
                {mqttEvents.map((e, i) => (
                  <div key={i} className="border-b border-border/30 py-1 last:border-b-0">
                    <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>{" "}
                    <span className="text-info">{e.topic}</span>{" "}
                    <span>{e.payloadSummary}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 6. Raw evidence */}
      {evidence && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Raw evidence</h2>
          <Card><CardContent className="p-3"><pre className="max-h-96 overflow-auto text-[11px] leading-snug">{JSON.stringify(evidence, null, 2)}</pre></CardContent></Card>
        </section>
      )}
    </div>
  );
}

function SummaryStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-foreground";
  return (
    <Card><CardContent className="flex items-center gap-3 p-4">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-lg font-semibold ${color}`}>{value}</div>
      </div>
    </CardContent></Card>
  );
}

type Tone = "ok" | "warn" | "fail" | "muted";
function LayerCard({ title, icon, items }: {
  title: string; icon: React.ReactNode;
  items: Array<{ label: string; badges: Array<{ label: string; tone: Tone }>; lines: string[] }>;
}) {
  return (
    <Card><CardContent className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
      {items.length === 0 ? <div className="text-xs text-muted-foreground">no data</div> : items.map((it, i) => (
        <div key={i} className="space-y-1 border-t border-border/50 pt-2 first:border-t-0 first:pt-0">
          <div className="text-xs font-medium">{it.label}</div>
          {it.badges.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {it.badges.map((b, j) => <span key={j} className={badgeClass(b.tone)}>{b.label}</span>)}
            </div>
          )}
          {it.lines.length > 0 && <ul className="space-y-0.5 text-[11px] text-muted-foreground">{it.lines.map((l, j) => <li key={j} className="font-mono">• {l}</li>)}</ul>}
        </div>
      ))}
    </CardContent></Card>
  );
}

function badgeClass(tone: Tone) {
  const base = "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium";
  if (tone === "ok") return `${base} border-success/40 bg-success/10 text-success`;
  if (tone === "warn") return `${base} border-warning/40 bg-warning/10 text-warning`;
  if (tone === "fail") return `${base} border-destructive/40 bg-destructive/10 text-destructive`;
  return `${base} border-border bg-muted/40 text-muted-foreground`;
}

function FeedCard({ title, icon, count, to, preview }: { title: string; icon: React.ReactNode; count: number; to: string; preview: string[] }) {
  return (
    <Card><CardContent className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        <Badge variant="outline">{count} signal{count === 1 ? "" : "s"}</Badge>
      </div>
      {preview.length === 0 ? (
        <div className="text-xs text-muted-foreground">no signals to forward</div>
      ) : (
        <ul className="space-y-1 text-xs text-muted-foreground">{preview.map((p, i) => <li key={i}>• {p}</li>)}</ul>
      )}
      <Button size="sm" variant="ghost" asChild><Link to={to}>Open <ArrowRight className="h-4 w-4" /></Link></Button>
    </CardContent></Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[11px]">{label}</Label>{children}</div>;
}

function DebugPanel({ evidence, ageLabel }: { evidence: DeepEvidence; ageLabel: string }) {
  const networkTargets = evidence.networkTruth?.targets?.length ?? 0;
  const processTargets = evidence.processTruth?.services?.length ?? 0;
  const portTargets = evidence.portTruth?.services?.length ?? 0;
  const configIssues = evidence.configTruth?.issues?.length ?? 0;
  const contradictions = evidence.contradictions?.length ?? 0;
  const rcSignals = evidence.rootCauseSignals?.length ?? 0;
  const traceSignals = evidence.traceSignals?.length ?? 0;
  const mqttAvailable = evidence.mqttTruth?.available ? "yes" : "no";

  const stats: Array<[string, string | number]> = [
    ["Age", ageLabel],
    ["Score", `${Math.round(evidence.evidenceScore ?? 0)}%`],
    ["Targets collected", evidence.targets?.length ?? 0],
    ["Network targets", networkTargets],
    ["Process targets", processTargets],
    ["Port targets", portTargets],
    ["MQTT available", mqttAvailable],
    ["Config issues", configIssues],
    ["Contradictions", contradictions],
    ["Root-cause signals", rcSignals],
    ["Trace signals", traceSignals],
    ["Source", evidence.mock ? "DEV MOCK" : "live"],
  ];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Debug panel</h2>
      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="font-mono text-sm">{String(v)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}