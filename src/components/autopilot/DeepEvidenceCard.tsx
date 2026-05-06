import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Microscope, AlertTriangle, ShieldCheck, ArrowRight } from "lucide-react";
import { evidenceCollect, evidenceLatest, type DeepEvidence } from "@/lib/agentClient";
import { loadSiteConfig } from "@/lib/siteConfig";

export function DeepEvidenceCard() {
  const [evidence, setEvidence] = useState<DeepEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await evidenceLatest();
      if ("ok" in r && r.ok) setEvidence(r.evidence);
    })();
  }, []);

  async function collect() {
    setBusy(true);
    setError(null);
    try {
      const cfg = loadSiteConfig();
      const r = await evidenceCollect({ siteConfig: cfg, services: cfg.services });
      if ("ok" in r && r.ok) setEvidence(r.evidence);
      else setError(("message" in r && r.message) || "Collection failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const contradictions = evidence?.contradictions ?? [];
  const top = contradictions[0];
  const score = evidence?.evidenceScore ?? 0;
  const ageMs = evidence?.collectedAt ? Date.now() - new Date(evidence.collectedAt).getTime() : null;
  const stale = ageMs !== null && ageMs > 15 * 60 * 1000;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Microscope className="h-4 w-4 text-info" />
            <span className="text-sm font-semibold uppercase tracking-wider">Deep Evidence</span>
            {evidence ? (
              <span className="text-[11px] text-muted-foreground">
                last {new Date(evidence.collectedAt).toLocaleTimeString()}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">no collection yet</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={collect} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
              Collect Deep Evidence
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/evidence">Open <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Evidence score" value={`${Math.round(score * 100)}%`} />
          <Stat label="Contradictions" value={String(contradictions.length)} tone={contradictions.length > 0 ? "warn" : "ok"} />
          <Stat label="Targets" value={String(evidence?.targets?.length ?? 0)} />
          <Stat label="MQTT tap" value={evidence?.mqttTruth?.available ? "live" : "off"} />
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        {stale && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
            ⚠ Deep Evidence stale — collect again before remediation.
          </div>
        )}

        {top ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Top contradiction
            </div>
            <div className="mt-1 text-foreground">{top.why}</div>
            <div className="mt-1 text-muted-foreground">
              {top.sourceA.layer} said “{top.sourceA.said}” · {top.sourceB.layer} said “{top.sourceB.said}”
              {top.target ? <> · target {top.target}</> : null}
            </div>
          </div>
        ) : evidence ? (
          <div className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> No contradictions across collected evidence layers.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}