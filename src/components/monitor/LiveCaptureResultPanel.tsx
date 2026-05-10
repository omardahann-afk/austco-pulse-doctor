import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useState } from "react";
import { Copy, Sparkles, AlertTriangle, ShieldAlert, ShieldCheck, ChevronRight } from "lucide-react";
import { requestAiExplanation, type CaptureSession, type DiagnosisResult, type DeveloperPackage, type SignalPathResult, type SignalPathHop } from "@/lib/liveCaptureClient";

interface Props {
  session: CaptureSession;
  diagnosis: DiagnosisResult;
  signalPath: SignalPathResult;
  developerPackage: DeveloperPackage;
}

function copy(text: string, label: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.error("Clipboard not available");
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error(`Could not copy ${label}`),
  );
}

function customerSafeSummary(diagnosis: DiagnosisResult): string {
  const where = diagnosis.rootCause?.applianceType || "an upstream component";
  const when = diagnosis.firstFailurePoint?.timestamp || "during the reproduction window";
  const conf = Math.round((diagnosis.confidence ?? 0) * 100);
  return [
    `During the live capture, the first failure was identified at ${where} (${when}).`,
    diagnosis.rootCause?.summary || "No deterministic root cause was identified from the captured evidence.",
    `Confidence: ${conf}%. Investigation will continue at the upstream component first; downstream symptoms will be re-checked once the upstream is restored.`,
  ].join(" ");
}

function StatusDot({ status }: { status: SignalPathHop["status"] }) {
  const cls =
    status === "ok" ? "bg-emerald-500" :
    status === "failed" ? "bg-rose-500" :
    "bg-muted-foreground/40";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden />;
}

function Section({ title, children, tone = "default" }: { title: string; children: React.ReactNode; tone?: "default" | "danger" | "warn" | "ok" }) {
  const headerCls =
    tone === "danger" ? "text-rose-400" :
    tone === "warn" ? "text-amber-400" :
    tone === "ok" ? "text-emerald-400" :
    "text-primary/80";
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-3">
      <div className={`mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${headerCls}`}>// {title}</div>
      <div className="text-[12.5px] leading-relaxed">{children}</div>
    </div>
  );
}

export function LiveCaptureResultPanel({ session, diagnosis, signalPath, developerPackage }: Props) {
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  async function explainWithAi() {
    setAiLoading(true);
    try {
      const r = await requestAiExplanation({
        diagnosis,
        developerPackage,
        confidenceBreakdown: diagnosis.confidenceBreakdown,
        doNotDo: diagnosis.doNotDo,
      });
      if (!r.ok) throw new Error(r.message || "AI gateway error");
      const resp = r.response as Record<string, unknown> | string | undefined;
      const text = typeof resp === "string"
        ? resp
        : JSON.stringify(resp, null, 2);
      setAiText(text || "(no AI response)");
      toast.success("AI explanation generated");
    } catch (err) {
      toast.error("AI explanation failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiLoading(false);
    }
  }

  const conf = Math.round((diagnosis.confidence ?? 0) * 100);
  const summary = customerSafeSummary(diagnosis);

  return (
    <Card className="border-2 border-primary/50 bg-gradient-to-b from-primary/5 to-card/60">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">// LIVE CAPTURE RESULT</div>
            <h2 className="text-base font-bold uppercase tracking-wide">Forensic Diagnosis · session {session.sessionId.slice(-8)}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">confidence {conf}%</Badge>
            <Button size="sm" variant="outline" onClick={() => copy(JSON.stringify(developerPackage, null, 2), "Developer package")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Developer Package
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(summary, "Customer summary")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Customer Summary
            </Button>
            <Button size="sm" onClick={explainWithAi} disabled={aiLoading}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {aiLoading ? "Explaining…" : "Explain Like Senior Austco Tech"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Section title="What Happened">
            <p>{session.problemStatement || "(no problem statement)"} </p>
            {session.actualBehavior && <p className="mt-1 text-muted-foreground">Actual: {session.actualBehavior}</p>}
            {session.expectedBehavior && <p className="text-muted-foreground">Expected: {session.expectedBehavior}</p>}
          </Section>

          <Section title="Root Cause" tone="danger">
            {diagnosis.rootCause ? (
              <div>
                <div className="font-mono text-xs font-semibold">{diagnosis.rootCause.applianceType}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{diagnosis.rootCause.kind}</div>
                <p className="mt-1">{diagnosis.rootCause.summary}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">No deterministic root cause identified from captured evidence.</p>
            )}
          </Section>

          <Section title="First Failure Point" tone="warn">
            {diagnosis.firstFailurePoint?.timestamp ? (
              <div className="space-y-1 font-mono text-[11.5px]">
                <div>{diagnosis.firstFailurePoint.timestamp}</div>
                <div>{diagnosis.firstFailurePoint.applianceType} · {diagnosis.firstFailurePoint.eventType}</div>
                {diagnosis.firstFailurePoint.rawMessage && (
                  <div className="rounded bg-muted/40 px-2 py-1 text-muted-foreground">{diagnosis.firstFailurePoint.rawMessage}</div>
                )}
              </div>
            ) : <p className="text-muted-foreground">No first failure point identified.</p>}
          </Section>

          <Section title="Why This Is Root Cause">
            <ul className="list-disc space-y-0.5 pl-4">
              {(developerPackage.deterministicReasoning || []).map((line, i) => <li key={i}>{line}</li>)}
              {!developerPackage.deterministicReasoning?.length && <li className="text-muted-foreground">No reasoning trace available.</li>}
            </ul>
          </Section>
        </div>

        <Section title="Signal Path">
          <div className="flex flex-wrap items-center gap-1.5">
            {signalPath.signalPath.map((hop, i) => {
              const isBroken = signalPath.brokenHop === hop.layerId;
              const isMissing = signalPath.firstMissingAck === hop.layerId;
              const ringCls = isBroken ? "ring-2 ring-rose-500" : isMissing ? "ring-2 ring-amber-500" : "";
              return (
                <div key={hop.layerId} className="flex items-center gap-1.5">
                  <div className={`flex items-center gap-1.5 rounded-md border border-border/60 bg-card/70 px-2 py-1 ${ringCls}`}>
                    <StatusDot status={hop.status} />
                    <span className="text-[11.5px] font-medium">{hop.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {hop.status === "ok" ? "ok" : hop.status === "failed" ? `failed (${hop.failureCount})` : "no evidence"}
                    </span>
                  </div>
                  {i < signalPath.signalPath.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10.5px] text-muted-foreground">
            <span>broken hop: <span className="text-rose-400">{signalPath.brokenHop || "—"}</span></span>
            <span>first missing ack: <span className="text-amber-400">{signalPath.firstMissingAck || "—"}</span></span>
            <span>propagation stop: {signalPath.propagationStop || "—"}</span>
          </div>
        </Section>

        <div className="grid gap-3 md:grid-cols-2">
          <Section title="Downstream Symptoms">
            {diagnosis.downstreamSymptoms.length === 0 ? (
              <p className="text-muted-foreground">No downstream symptoms identified.</p>
            ) : (
              <ul className="space-y-1">
                {diagnosis.downstreamSymptoms.slice(0, 12).map((d) => (
                  <li key={d.eventId} className="font-mono text-[11px]">
                    <span className="text-muted-foreground">{d.timestamp}</span> · {d.applianceType} · {d.eventType}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Supporting Evidence">
            <div className="max-h-48 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10.5px]">
              {diagnosis.evidenceTimeline.slice(0, 60).map((e) => (
                <div key={e.eventId} className="mb-1 leading-tight">
                  <span className={e.severity === "critical" ? "text-rose-400" : e.severity === "warning" ? "text-amber-400" : "text-muted-foreground"}>
                    [{e.severity}]
                  </span>{" "}
                  <span className="text-muted-foreground">{e.timestamp}</span>{" "}
                  {e.applianceType} · {e.eventType} {e.callpointId ? `· ${e.callpointId}` : ""}
                  <div className="text-muted-foreground/80">{e.rawMessage}</div>
                </div>
              ))}
              {!diagnosis.evidenceTimeline.length && <div className="text-muted-foreground">No evidence captured in window.</div>}
            </div>
          </Section>

          <Section title="Contradictions" tone={diagnosis.contradictions.length ? "warn" : "default"}>
            {diagnosis.contradictions.length === 0 ? (
              <p className="text-muted-foreground">No contradictions detected.</p>
            ) : (
              <ul className="space-y-1">
                {diagnosis.contradictions.map((c, i) => (
                  <li key={i}><strong>{c.kind}</strong> — {c.detail}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Confidence Breakdown">
            <ul className="space-y-0.5">
              {diagnosis.confidenceBreakdown.map((b, i) => (
                <li key={i} className="font-mono text-[11px]">
                  <span className={b.delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {b.delta >= 0 ? "+" : ""}{(b.delta * 100).toFixed(0)}%
                  </span>{" "}
                  <span className="text-muted-foreground">{b.reason}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Next Tech Checks" tone="ok">
            {diagnosis.nextChecks.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {diagnosis.nextChecks.map((c, i) => <li key={i}><ShieldCheck className="mr-1 inline h-3 w-3 text-emerald-400" />{c}</li>)}
              </ul>
            ) : <p className="text-muted-foreground">No specific next checks recommended.</p>}
          </Section>

          <Section title="Do NOT Do" tone="danger">
            {diagnosis.doNotDo.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {diagnosis.doNotDo.map((c, i) => <li key={i}><ShieldAlert className="mr-1 inline h-3 w-3 text-rose-400" />{c}</li>)}
              </ul>
            ) : <p className="text-muted-foreground">No explicit do-not-do guidance.</p>}
            {diagnosis.ruledOut.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Ruled out: {diagnosis.ruledOut.join(" · ")}
              </div>
            )}
          </Section>
        </div>

        <Section title="Developer Escalation Package">
          <pre className="max-h-48 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10.5px]">{JSON.stringify(developerPackage, null, 2)}</pre>
        </Section>

        <Section title="Customer-Safe Summary">
          <p className="whitespace-pre-wrap">{summary}</p>
        </Section>

        {aiText && (
          <Section title="AI Explanation (advisory only)" tone="warn">
            <div className="mb-2 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              AI explanation. Deterministic diagnosis remains source of truth.
            </div>
            <Textarea readOnly value={aiText} className="min-h-40 font-mono text-[11px]" />
          </Section>
        )}
      </CardContent>
    </Card>
  );
}