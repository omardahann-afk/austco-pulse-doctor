import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useState } from "react";
import {
  Copy, Sparkles, AlertTriangle, ShieldAlert, ShieldCheck, ChevronRight,
  ChevronDown, Crosshair, ListOrdered, Wrench, FileSearch, HelpCircle,
} from "lucide-react";
import {
  requestAiExplanation,
  type CaptureSession, type DiagnosisResult, type DeveloperPackage,
  type SignalPathResult, type SignalPathHop, type CorrelationStory,
  type ApplianceBreakdownItem, type IncidentSequenceItem, type CauseVsSymptomItem,
} from "@/lib/liveCaptureClient";

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

function StatusDot({ status }: { status: SignalPathHop["status"] }) {
  const cls =
    status === "ok" ? "bg-emerald-500" :
    status === "failed" ? "bg-rose-500" :
    "bg-muted-foreground/40";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden />;
}

function Section({
  title, icon, children, tone = "default",
}: { title: string; icon?: React.ReactNode; children: React.ReactNode; tone?: "default" | "danger" | "warn" | "ok" | "primary" }) {
  const headerCls =
    tone === "danger" ? "text-rose-400" :
    tone === "warn" ? "text-amber-400" :
    tone === "ok" ? "text-emerald-400" :
    tone === "primary" ? "text-primary" :
    "text-primary/80";
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-3">
      <div className={`mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${headerCls}`}>
        {icon}// {title}
      </div>
      <div className="text-[12.5px] leading-relaxed">{children}</div>
    </div>
  );
}

function Collapsed({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded border border-border/40 bg-card/30 px-3 py-1.5 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:bg-card/60">
        <span>// {title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function classBadge(cls: string) {
  const map: Record<string, string> = {
    first_failure: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    root_cause_evidence: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    downstream_symptom: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    supporting_evidence: "bg-muted text-muted-foreground border-border",
    contradiction: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    missing_evidence: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    missing_evidence_needed: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    likely_root_cause: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    evidence_holder: "bg-primary/15 text-primary border-primary/30",
    no_relevant_evidence: "bg-muted text-muted-foreground border-border",
    cause: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    symptom: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    unknown: "bg-muted text-muted-foreground border-border",
    noise: "bg-muted text-muted-foreground/60 border-border",
  };
  return map[cls] || "bg-muted text-muted-foreground border-border";
}

interface AiResult {
  fieldTechExplanation?: string;
  seniorEngineerExplanation?: string;
  devEscalationExplanation?: string;
  customerSafeExplanation?: string;
  whatToCheckFirst?: string | string[];
  whatNotToTouch?: string | string[];
  raw?: string;
}

function parseAi(resp: unknown): AiResult | null {
  if (!resp) return null;
  if (typeof resp === "string") {
    try { return parseAi(JSON.parse(resp)); } catch { return { raw: resp }; }
  }
  if (typeof resp === "object") return resp as AiResult;
  return null;
}

export function LiveCaptureResultPanel({ session, diagnosis, signalPath, developerPackage }: Props) {
  const story: CorrelationStory | null = diagnosis.correlationStory || developerPackage.correlationStory || null;
  const conf = Math.round((diagnosis.confidence ?? 0) * 100);

  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function explainCorrelation() {
    if (!story) {
      toast.error("No correlation story to explain");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const sanitized = {
        kind: "correlation_story",
        correlationStory: story,
        rootCause: diagnosis.rootCause,
        firstFailurePoint: diagnosis.firstFailurePoint,
        nextChecks: diagnosis.nextChecks,
        doNotDo: diagnosis.doNotDo,
        confidenceBreakdown: diagnosis.confidenceBreakdown,
        evidenceSnippets: diagnosis.evidenceTimeline.slice(0, 25).map((e) => ({
          timestamp: e.timestamp, applianceType: e.applianceType,
          eventType: e.eventType, severity: e.severity,
          callpointId: e.callpointId,
        })),
      };
      const r = await requestAiExplanation({
        diagnosis,
        developerPackage,
        confidenceBreakdown: diagnosis.confidenceBreakdown,
        doNotDo: diagnosis.doNotDo,
        correlation: sanitized,
      });
      if (!r.ok) throw new Error(r.message || "AI gateway error");
      const parsed = parseAi(r.response);
      if (!parsed) throw new Error("AI returned no usable response");
      setAiResult(parsed);
      toast.success("AI explanation generated");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  /* ---------- escalation summary builders (deterministic) ---------- */
  const techSummary = (() => {
    const lines = [
      `FINAL ANSWER: ${story?.plainEnglishSummary || "Insufficient evidence."}`,
      `Why: ${story?.whyThisMatters || ""}`,
      story?.whatHappenedFirst
        ? `First failure: ${story.whatHappenedFirst.timestamp} — ${story.whatHappenedFirst.appliance} — ${story.whatHappenedFirst.eventType}`
        : "First failure: (none identified)",
      `Confidence: ${conf}%`,
      "",
      "CHECK FIRST:",
      ...(diagnosis.nextChecks.length ? diagnosis.nextChecks.map((c) => ` - ${c}`) : [" - (no specific checks)"]),
      "",
      "DO NOT:",
      ...(diagnosis.doNotDo.length ? diagnosis.doNotDo.map((c) => ` - ${c}`) : [" - (no explicit do-not-do)"]),
      "",
      "MISSING EVIDENCE:",
      ...((story?.missingEvidence || []).length ? story!.missingEvidence.map((m) => ` - ${m}`) : [" - none flagged"]),
    ];
    return lines.join("\n");
  })();

  const devSummary = (() => {
    const seq = (story?.incidentSequence || []).slice(0, 50)
      .map((i) => ` ${i.order}. [${i.classification}] ${i.summary}`).join("\n");
    return [
      `# Tacera Live Capture Escalation`,
      `Session: ${session.sessionId}`,
      `Problem: ${session.problemStatement || "(none)"}`,
      `Reproduction window: ${session.reproductionStartedAt || "?"} → ${session.reproductionEndedAt || "?"}`,
      ``,
      `## Final Answer`,
      story?.plainEnglishSummary || "Insufficient evidence.",
      ``,
      `## First failure point`,
      diagnosis.firstFailurePoint
        ? `${diagnosis.firstFailurePoint.timestamp} — ${diagnosis.firstFailurePoint.applianceType} — ${diagnosis.firstFailurePoint.eventType}\n${diagnosis.firstFailurePoint.rawMessage || ""}`
        : "(none)",
      ``,
      `## Root cause candidate`,
      diagnosis.rootCause ? `${diagnosis.rootCause.applianceType} (${diagnosis.rootCause.kind})\n${diagnosis.rootCause.summary}` : "(none)",
      ``,
      `## Affected callpoints`,
      diagnosis.affectedCallpoints.join(", ") || "(none)",
      ``,
      `## Correlated appliances`,
      (story?.applianceBreakdown || []).map((a) => ` - ${a.appliance} [${a.classification}] — ${a.explanation}`).join("\n") || "(none)",
      ``,
      `## Downstream symptoms`,
      (story?.causeVsSymptom || []).filter((c) => c.classification === "symptom").map((c) => ` - ${c.appliance} (${c.timing}) — ${c.evidence}`).join("\n") || "(none)",
      ``,
      `## Missing evidence`,
      (story?.missingEvidence || []).map((m) => ` - ${m}`).join("\n") || "(none)",
      ``,
      `## Incident sequence`,
      seq || "(empty)",
      ``,
      `## Next checks`,
      diagnosis.nextChecks.map((c) => ` - ${c}`).join("\n") || "(none)",
    ].join("\n");
  })();

  const customerSummary = story?.customerSafeConclusion ||
    "We are still gathering evidence; no single root cause has been confirmed yet.";

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
            <Button size="sm" variant="outline" onClick={() => copy(techSummary, "Tech summary")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Tech Summary
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(devSummary, "Developer summary")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Developer Summary
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(customerSummary, "Customer summary")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Customer Summary
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(JSON.stringify(developerPackage, null, 2), "Full evidence package")}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Full Evidence Package
            </Button>
            <Button size="sm" onClick={explainCorrelation} disabled={aiLoading || !story}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {aiLoading ? "Explaining…" : "Explain Correlation Like Senior Tech"}
            </Button>
          </div>
        </div>

        {/* SECTION 1 — FINAL ANSWER */}
        <Section title="FINAL ANSWER" icon={<Crosshair className="h-3 w-3" />} tone="primary">
          {!story || conf === 0 ? (
            <div>
              <p className="text-base font-semibold text-amber-300">Insufficient evidence to diagnose.</p>
              <p className="mt-1 text-muted-foreground">{story?.whyThisMatters || "No deterministic root cause was identified from the captured evidence in the reproduction window."}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-base font-semibold">{story.plainEnglishSummary}</p>
              <p><span className="text-muted-foreground">Why: </span>{story.whyThisMatters}</p>
              {diagnosis.firstFailurePoint?.timestamp && (
                <p><span className="text-muted-foreground">First failure point: </span>
                  <span className="font-mono">{diagnosis.firstFailurePoint.timestamp}</span> — {diagnosis.firstFailurePoint.applianceType} — {diagnosis.firstFailurePoint.eventType}
                </p>
              )}
              {diagnosis.nextChecks[0] && (
                <p className="text-emerald-300"><span className="text-muted-foreground">Check first: </span>{diagnosis.nextChecks[0]}</p>
              )}
              {diagnosis.doNotDo[0] && (
                <p className="text-rose-300"><span className="text-muted-foreground">Do not: </span>{diagnosis.doNotDo[0]}</p>
              )}
            </div>
          )}
        </Section>

        {/* SECTION 2 — CORRELATION STORY */}
        {story && (
          <Section title="CORRELATION STORY" icon={<FileSearch className="h-3 w-3" />}>
            <p className="whitespace-pre-wrap">{story.whyThisMatters}</p>
            {story.incidentSequence.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                {story.incidentSequence.length} event{story.incidentSequence.length === 1 ? "" : "s"} captured in window across {story.applianceBreakdown.length} appliance{story.applianceBreakdown.length === 1 ? "" : "s"}.
              </p>
            )}
          </Section>
        )}

        {/* SECTION 3 — WHAT HAPPENED FIRST */}
        <Section title="WHAT HAPPENED FIRST" icon={<ListOrdered className="h-3 w-3" />} tone="warn">
          {story?.whatHappenedFirst ? (
            <div className="space-y-1">
              <div className="font-mono text-[12px]">
                <span className="text-amber-300">{story.whatHappenedFirst.timestamp}</span> — <strong>{story.whatHappenedFirst.appliance}</strong> — {story.whatHappenedFirst.eventType}
              </div>
              {story.whatHappenedFirst.rawMessage && (
                <div className="rounded bg-muted/40 px-2 py-1 font-mono text-[10.5px] text-muted-foreground">{story.whatHappenedFirst.rawMessage}</div>
              )}
              <p className="text-muted-foreground">Why it matters: {story.whatHappenedFirst.whyItMatters}</p>
            </div>
          ) : (
            <p className="text-muted-foreground">No first failure event identified in the reproduction window.</p>
          )}
        </Section>

        {/* SECTION 4 — CAUSE VS SYMPTOM */}
        {story && story.causeVsSymptom.length > 0 && (
          <Section title="CAUSE VS SYMPTOM" icon={<HelpCircle className="h-3 w-3" />}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-border/50 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1 pr-2">Appliance</th>
                    <th className="py-1 pr-2">Class</th>
                    <th className="py-1 pr-2">Timing</th>
                    <th className="py-1 pr-2">Evidence</th>
                    <th className="py-1">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {story.causeVsSymptom.map((c: CauseVsSymptomItem, i) => (
                    <tr key={i} className="border-b border-border/20 align-top">
                      <td className="py-1 pr-2 font-medium">{c.appliance}</td>
                      <td className="py-1 pr-2"><span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${classBadge(c.classification)}`}>{c.classification.replace(/_/g, " ")}</span></td>
                      <td className="py-1 pr-2 font-mono text-[10.5px]">{c.timing}</td>
                      <td className="py-1 pr-2">{c.evidence}</td>
                      <td className="py-1 text-muted-foreground">{c.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* SECTION 5 — APPLIANCE BREAKDOWN */}
        {story && story.applianceBreakdown.length > 0 && (
          <Section title="APPLIANCE-BY-APPLIANCE BREAKDOWN" icon={<Wrench className="h-3 w-3" />}>
            <div className="grid gap-2 md:grid-cols-2">
              {story.applianceBreakdown.map((a: ApplianceBreakdownItem) => (
                <div key={a.applianceType} className="rounded border border-border/50 bg-background/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-semibold">{a.appliance}</div>
                      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{a.role}</div>
                    </div>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${classBadge(a.classification)}`}>{a.classification.replace(/_/g, " ")}</span>
                  </div>
                  <p className="mt-1 text-[11.5px]">{a.explanation}</p>
                  <div className="mt-1 grid gap-0.5 text-[11px]">
                    <div><span className="text-muted-foreground">Proves: </span>{a.whatItProves}</div>
                    <div><span className="text-muted-foreground">Does not prove: </span>{a.whatItDoesNotProve}</div>
                    <div><span className="text-emerald-400">Next check: </span>{a.nextCheck}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* SECTION 6 + 7 — NEXT CHECKS / DO NOT TOUCH */}
        <div className="grid gap-3 md:grid-cols-2">
          <Section title="NEXT TECH CHECKS" icon={<ShieldCheck className="h-3 w-3" />} tone="ok">
            {diagnosis.nextChecks.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {diagnosis.nextChecks.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : <p className="text-muted-foreground">No specific next checks recommended.</p>}
          </Section>
          <Section title="DO NOT TOUCH" icon={<ShieldAlert className="h-3 w-3" />} tone="danger">
            {diagnosis.doNotDo.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {diagnosis.doNotDo.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : <p className="text-muted-foreground">No explicit do-not-do guidance.</p>}
            {diagnosis.ruledOut.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">Ruled out: {diagnosis.ruledOut.join(" · ")}</div>
            )}
          </Section>
        </div>

        {/* MISSING EVIDENCE */}
        {(story?.missingEvidence?.length ?? 0) > 0 && (
          <Section title="MISSING EVIDENCE" icon={<HelpCircle className="h-3 w-3" />} tone="warn">
            <ul className="list-disc space-y-0.5 pl-4">
              {story!.missingEvidence.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </Section>
        )}

        {/* SIGNAL PATH */}
        <Section title="SIGNAL PATH">
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
        </Section>

        {/* AI EXPLANATION */}
        {(aiResult || aiError) && (
          <Section title="AI EXPLANATION (advisory only)" tone="warn">
            <div className="mb-2 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              AI explanation only. Deterministic engine remains source of truth.
            </div>
            {aiError ? (
              <p className="text-amber-300">AI explanation unavailable. Deterministic forensic diagnosis remains active. ({aiError})</p>
            ) : aiResult && (
              <div className="space-y-2 text-[12px]">
                {aiResult.fieldTechExplanation && (<div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Field Tech</div><p>{aiResult.fieldTechExplanation}</p></div>)}
                {aiResult.seniorEngineerExplanation && (<div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Senior Engineer</div><p>{aiResult.seniorEngineerExplanation}</p></div>)}
                {aiResult.devEscalationExplanation && (<div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Developer Escalation</div><p>{aiResult.devEscalationExplanation}</p></div>)}
                {aiResult.customerSafeExplanation && (<div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Customer-safe</div><p>{aiResult.customerSafeExplanation}</p></div>)}
                {aiResult.raw && (<Textarea readOnly value={aiResult.raw} className="min-h-32 font-mono text-[11px]" />)}
              </div>
            )}
          </Section>
        )}

        {/* COLLAPSED — RAW EVIDENCE */}
        <Collapsed title="Raw evidence timeline">
          <div className="max-h-72 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10.5px]">
            {(story?.incidentSequence || []).map((e: IncidentSequenceItem) => (
              <div key={e.order} className="mb-1 leading-tight">
                <span className={`mr-1 rounded border px-1 text-[9px] uppercase ${classBadge(e.classification)}`}>{e.classification.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{e.timestamp}</span>{" "}
                <strong>{e.appliance}</strong> · {e.eventType}
                <div className="text-muted-foreground/80">{e.whyItMatters}</div>
              </div>
            ))}
            {(!story || story.incidentSequence.length === 0) && <div className="text-muted-foreground">No evidence captured in window.</div>}
          </div>
        </Collapsed>

        <Collapsed title="Full normalized events">
          <div className="max-h-72 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10.5px]">
            {diagnosis.evidenceTimeline.map((e) => (
              <div key={e.eventId} className="mb-1 leading-tight">
                <span className={e.severity === "critical" ? "text-rose-400" : e.severity === "warning" ? "text-amber-400" : "text-muted-foreground"}>[{e.severity}]</span>{" "}
                <span className="text-muted-foreground">{e.timestamp}</span>{" "}
                {e.applianceType} · {e.eventType} {e.callpointId ? `· ${e.callpointId}` : ""}
                <div className="text-muted-foreground/80">{e.rawMessage}</div>
              </div>
            ))}
            {!diagnosis.evidenceTimeline.length && <div className="text-muted-foreground">No normalized events.</div>}
          </div>
        </Collapsed>

        <Collapsed title="Confidence math details">
          <div className="space-y-1">
            <ul>
              {diagnosis.confidenceBreakdown.map((b, i) => (
                <li key={i} className="font-mono text-[11px]">
                  <span className={b.delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {b.delta >= 0 ? "+" : ""}{(b.delta * 100).toFixed(0)}%
                  </span>{" "}
                  <span className="text-muted-foreground">{b.reason}</span>
                </li>
              ))}
            </ul>
            {diagnosis.contradictions.length > 0 && (
              <div className="mt-2 text-[11.5px]">
                <div className="text-amber-400">Contradictions:</div>
                <ul className="list-disc pl-4">
                  {diagnosis.contradictions.map((c, i) => <li key={i}><strong>{c.kind}</strong> — {c.detail}</li>)}
                </ul>
              </div>
            )}
          </div>
        </Collapsed>

        <Collapsed title="Developer escalation JSON (full)">
          <pre className="max-h-72 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10.5px]">{JSON.stringify(developerPackage, null, 2)}</pre>
        </Collapsed>
      </CardContent>
    </Card>
  );
}
