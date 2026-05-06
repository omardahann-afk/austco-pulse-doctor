import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Trash2, Download, RotateCcw, Brain } from "lucide-react";
import { loadAudit, clearAudit, type CcpAuditEntry } from "@/lib/ccpAudit";
import { saveSiteConfig } from "@/lib/siteConfig";
import { setHandoff } from "@/lib/aiCommanderHandoff";

export const Route = createFileRoute("/import-history")({
  head: () => ({ meta: [
    { title: "Config Import History — Tacera Doctor" },
    { name: "description", content: "Audit trail of every CCP / JSON site-config import." },
  ]}),
  component: ImportHistoryPage,
});

function statusTone(s: string): string {
  switch (s) {
    case "imported": return "bg-success/15 text-success border-success/40";
    case "low_confidence": return "bg-warning/15 text-warning border-warning/40";
    case "preview_cancelled": return "bg-muted/30 text-muted-foreground border-border/60";
    case "failed": return "bg-critical/15 text-critical border-critical/40";
    default: return "bg-muted/30";
  }
}

function ImportHistoryPage() {
  const [entries, setEntries] = useState<CcpAuditEntry[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { setEntries(loadAudit()); }, []);

  function refresh() { setEntries(loadAudit()); }

  function restore(e: CcpAuditEntry) {
    if (!e.previousConfigSnapshot) { setInfo("No previous-config snapshot stored for this entry."); return; }
    if (!confirm(`Restore site config to the state BEFORE "${e.filename}" (${new Date(e.timestamp).toLocaleString()})? This overwrites the current config.`)) return;
    saveSiteConfig(e.previousConfigSnapshot);
    setInfo(`Restored config from before ${e.filename}. Reload the Command Center to see it.`);
  }

  function reapply(e: CcpAuditEntry) {
    if (!e.newConfigSnapshot) { setInfo("No imported-config snapshot stored for this entry."); return; }
    if (!confirm(`Re-apply imported config from "${e.filename}"? This overwrites the current config.`)) return;
    saveSiteConfig(e.newConfigSnapshot);
    setInfo(`Re-applied config from ${e.filename}.`);
  }

  function exportEntry(e: CcpAuditEntry) {
    const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit_${e.auditId}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ccp_import_audit.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    if (!confirm("Delete the entire import history? This cannot be undone.")) return;
    clearAudit(); refresh();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Audit Trail"
        title="Config Import History"
        description="Every CCP / JSON site-config import is recorded here. Review, export, or restore a previous config snapshot."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline"><Link to="/"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Command Center</Link></Button>
        <Button size="sm" variant="outline" onClick={exportAll} disabled={entries.length === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export All
        </Button>
        <Button size="sm" variant="outline" onClick={clearAll} disabled={entries.length === 0}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear History
        </Button>
        <div className="ml-auto text-xs text-muted-foreground font-mono">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</div>
      </div>

      {info && <div className="rounded border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">{info}</div>}

      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Import History</CardTitle></CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="rounded border border-border/40 bg-card/40 p-4 text-xs text-muted-foreground">
              No imports recorded yet. Use the Command Center → "Import Site Config" to import a CCP or JSON file.
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">When</TableHead>
                    <TableHead className="text-[11px]">File</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px]">Confidence</TableHead>
                    <TableHead className="text-[11px]">Counts</TableHead>
                    <TableHead className="text-[11px]">Warnings</TableHead>
                    <TableHead className="text-[11px]">Checksum</TableHead>
                    <TableHead className="text-[11px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const crit = e.warnings.filter((w) => w.severity === "CRITICAL").length;
                    const warn = e.warnings.filter((w) => w.severity === "WARNING").length;
                    return (
                      <TableRow key={e.auditId}>
                        <TableCell className="text-[11px] font-mono">{new Date(e.timestamp).toLocaleString()}</TableCell>
                        <TableCell className="text-[11px] font-mono">{e.filename} <span className="opacity-60">[{e.fileType}]</span></TableCell>
                        <TableCell><Badge variant="outline" className={statusTone(e.status) + " text-[10px]"}>{e.status}</Badge></TableCell>
                        <TableCell className="text-[11px] font-mono">{e.parseConfidence} ({e.confidenceScore}%)</TableCell>
                        <TableCell className="text-[11px] font-mono">{e.importedControllers}c / {e.importedDevices}d / {e.importedRooms}r</TableCell>
                        <TableCell className="text-[11px] font-mono">
                          {crit > 0 && <span className="text-critical">{crit}!</span>}{crit > 0 && warn > 0 && " · "}
                          {warn > 0 && <span className="text-warning">{warn}w</span>}
                          {crit === 0 && warn === 0 && <span className="opacity-60">—</span>}
                        </TableCell>
                        <TableCell className="text-[11px] font-mono opacity-70">{e.checksum}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => reapply(e)} disabled={!e.newConfigSnapshot}>
                              <RotateCcw className="mr-1 h-3 w-3" /> Re-apply
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => restore(e)} disabled={!e.previousConfigSnapshot}>
                              <RotateCcw className="mr-1 h-3 w-3" /> Restore prev
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => exportEntry(e)}>
                              <Download className="mr-1 h-3 w-3" /> JSON
                            </Button>
                            <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                              onClick={() => setHandoff({
                                source: "deep-evidence", mode: "explain_on_site",
                                context: {
                                  affectedServices: ["CCP Import"],
                                  deepEvidence: { auditEntry: { ...e, previousConfigSnapshot: undefined, newConfigSnapshot: undefined } },
                                  contradictions: e.warnings.filter((w) => w.severity !== "INFO").map((w) => ({
                                    kind: w.code,
                                    sourceA: { layer: "config", said: w.title },
                                    sourceB: { layer: "config", said: w.affectedObject || "—" },
                                    why: w.explanation, likelyLayer: "configuration", confidence: 0.6,
                                  })),
                                },
                              })}>
                              <Link to="/ai-commander"><Brain className="mr-1 h-3 w-3" /> Ask AI</Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}