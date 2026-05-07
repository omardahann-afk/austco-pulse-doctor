import { useEffect, useState } from "react";
import { Camera, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

const EVIDENCE_UPDATED_EVENT = "evidence-snapshots:updated";

type Snapshot = {
  snapshotId: string;
  createdAt: string;
  reason: string;
  device?: { id?: string; name?: string; host?: string; protocol?: string };
  probe?: { ok?: boolean; latencyMs?: number | null; error?: string | null };
  deterministicFindings?: Array<Record<string, unknown>>;
  included?: Record<string, boolean>;
  limitations?: string[];
};

export function EvidenceSnapshotsPanel() {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/evidence/snapshots");
      const j = await r.json();
      if (j.ok) setSnapshots(j.snapshots || []);
      else toast.error(j.message || "Failed to load snapshots");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener(EVIDENCE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EVIDENCE_UPDATED_EVENT, handler);
  }, []);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex flex-1 items-center gap-1.5 text-left">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Camera className="h-3.5 w-3.5" /> Evidence Snapshots
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{snapshots.length}</span>
                </CardTitle>
              </button>
            </CollapsibleTrigger>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); void load(); }}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {snapshots.length === 0 ? (
              <p className="text-xs text-muted-foreground">No snapshots yet. Click "Capture Evidence" on a saved device.</p>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2 pr-3">
                  {snapshots.map((s) => (
                    <div key={s.snapshotId} className="rounded-md border border-border/40 bg-muted/10 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{s.device?.name || s.device?.id || "device"}</div>
                        <span className="text-[10px] text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="rounded bg-muted px-1.5 py-0.5">{s.reason}</span>
                        {s.probe && (
                          <span className={`rounded px-1.5 py-0.5 ${s.probe.ok ? "bg-emerald-500/20 text-emerald-300" : "bg-destructive/20 text-destructive"}`}>
                            probe {s.probe.ok ? "OK" : "FAIL"}{s.probe.latencyMs != null ? ` · ${s.probe.latencyMs.toFixed(0)}ms` : ""}
                          </span>
                        )}
                        {s.included && Object.entries(s.included).filter(([, v]) => v).map(([k]) => (
                          <span key={k} className="rounded bg-muted px-1.5 py-0.5">{k}</span>
                        ))}
                      </div>
                      {s.probe?.error && <div className="mt-1 truncate text-[10px] text-destructive" title={s.probe.error}>{s.probe.error}</div>}
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{s.snapshotId}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}