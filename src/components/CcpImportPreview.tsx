/**
 * CCP Import Preview — Mission Control modal.
 * Shows file summary, parser metrics, structured warnings, and a full
 * breakdown of controllers / devices / rooms / zones / unknown sections,
 * plus an optional diff against the existing SiteConfig.
 * Read-only until the user confirms.
 */
import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, AlertTriangle, AlertOctagon, Info, CheckCircle2, FileWarning, ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { setHandoff } from "@/lib/aiCommanderHandoff";
import type { CcpParseResult, CcpWarning, CcpArchiveFile, CcpPlugin, CcpEndpoint } from "@/lib/ccpParser";
import type { CcpDiff } from "@/lib/ccpDiff";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filename: string;
  fileSizeBytes: number;
  parsed: CcpParseResult | null;
  diff: CcpDiff | null;
  hasExistingConfig: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const SEV_BADGE: Record<CcpWarning["severity"], string> = {
  CRITICAL: "bg-critical/15 text-critical border-critical/40",
  WARNING:  "bg-warning/15 text-warning border-warning/40",
  INFO:     "bg-info/15 text-info border-info/40",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function CcpImportPreview(props: Props) {
  const { open, onOpenChange, filename, fileSizeBytes, parsed, diff, hasExistingConfig, onConfirm, onCancel } = props;

  const counts = useMemo(() => ({
    critical: (parsed?.structuredWarnings || []).filter((w) => w.severity === "CRITICAL").length,
    warning:  (parsed?.structuredWarnings || []).filter((w) => w.severity === "WARNING").length,
    info:     (parsed?.structuredWarnings || []).filter((w) => w.severity === "INFO").length,
  }), [parsed]);

  const lowConfidence = (parsed?.confidenceScore ?? 0) < 60;
  const canImport = !!parsed && parsed.status !== "parse_failed";
  const isZip = parsed?.status === "ccp_zip_detected" || !!parsed?.archive?.isZip;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileWarning className="h-4 w-4 text-info" />
            CCP Import Preview
            <Badge variant="outline" className="ml-2 font-mono text-[10px]">Mission Control</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review parser output before committing to your site config. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="p-6 text-sm text-muted-foreground">No file parsed.</div>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <div className="space-y-4">
              {/* A — File Summary */}
              <section className="rounded border border-border/60 bg-card/50 p-3">
                <div className="mb-2 text-[11px] font-mono uppercase text-muted-foreground">A · File Summary</div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <SummaryItem label="Filename" value={filename} mono />
                  <SummaryItem label="Size" value={fmtBytes(fileSizeBytes)} mono />
                  <SummaryItem label="Parser status" value={parsed.status} mono />
                  <SummaryItem label="Parser version" value={parsed.parserVersion || "—"} mono />
                  <SummaryItem label="Confidence" value={`${parsed.confidence} (${parsed.confidenceScore ?? 0}%)`} />
                  <SummaryItem label="Imported at" value={new Date().toLocaleString()} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <Badge variant="outline" className={SEV_BADGE.CRITICAL}>{counts.critical} critical</Badge>
                  <Badge variant="outline" className={SEV_BADGE.WARNING}>{counts.warning} warnings</Badge>
                  <Badge variant="outline" className={SEV_BADGE.INFO}>{counts.info} info</Badge>
                  <Badge variant="outline" className="bg-muted/30">
                    {parsed.controllers.length} controllers · {parsed.devices.length} devices · {parsed.rooms.length} rooms
                  </Badge>
                  {isZip && (
                    <Badge variant="outline" className="bg-info/15 text-info border-info/40">
                      CCP ZIP detected · {parsed.archive?.internalFileCount ?? 0} files · {parsed.archive?.xmlFileCount ?? 0} XML · {parsed.plugins?.length ?? 0} plugins · {parsed.endpoints?.length ?? 0} endpoints
                    </Badge>
                  )}
                  {parsed.parserMetrics && (
                    <Badge variant="outline" className="bg-muted/30 font-mono">
                      lines:{parsed.parserMetrics.linesRead} · matched:{parsed.parserMetrics.matchedSections} · unknown:{parsed.parserMetrics.unknownSections} · {parsed.parserMetrics.parseDurationMs}ms
                    </Badge>
                  )}
                </div>
                {lowConfidence && (
                  <div className="mt-3 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                    <ShieldAlert className="mt-[1px] h-3.5 w-3.5" />
                    <span><strong>Low-confidence import.</strong> Manual review required before trusting these mappings.</span>
                  </div>
                )}
              </section>

              {/* Warnings panel */}
              {(parsed.structuredWarnings && parsed.structuredWarnings.length > 0) && (
                <section className="rounded border border-border/60 bg-card/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-mono uppercase text-muted-foreground">Parse Warnings</div>
                  </div>
                  <ul className="space-y-1.5">
                    {parsed.structuredWarnings.map((w, i) => (
                      <li key={i} className={`rounded border px-2 py-1.5 text-[11px] ${SEV_BADGE[w.severity]}`}>
                        <div className="flex items-center gap-1.5 font-medium">
                          {w.severity === "CRITICAL" ? <AlertOctagon className="h-3.5 w-3.5" />
                            : w.severity === "WARNING" ? <AlertTriangle className="h-3.5 w-3.5" />
                            : <Info className="h-3.5 w-3.5" />}
                          <span>{w.title}</span>
                          <span className="ml-auto font-mono text-[10px] opacity-70">{w.code}</span>
                        </div>
                        <div className="mt-0.5 opacity-90">{w.explanation}</div>
                        {w.affectedObject && <div className="mt-0.5 font-mono text-[10px] opacity-70">↳ {w.affectedObject}</div>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Tabs defaultValue="controllers" className="w-full">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="controllers">Controllers ({parsed.controllers.length})</TabsTrigger>
                  <TabsTrigger value="devices">Devices ({parsed.devices.length})</TabsTrigger>
                  <TabsTrigger value="rooms">Rooms ({parsed.rooms.length})</TabsTrigger>
                  <TabsTrigger value="zones">Zones ({parsed.zones.length + parsed.groupSignals.length})</TabsTrigger>
                  {isZip && <TabsTrigger value="files">Files ({parsed.archive?.internalFileCount ?? 0})</TabsTrigger>}
                  {isZip && <TabsTrigger value="plugins">Plugins ({parsed.plugins?.length ?? 0})</TabsTrigger>}
                  {isZip && <TabsTrigger value="endpoints">Endpoints ({parsed.endpoints?.length ?? 0})</TabsTrigger>}
                  <TabsTrigger value="unknown">Unknown ({(parsed.rawUnparsed || []).length})</TabsTrigger>
                  {hasExistingConfig && <TabsTrigger value="diff">Diff{diff ? ` (${diff.totals.added}/${diff.totals.changed}/${diff.totals.removed})` : ""}</TabsTrigger>}
                </TabsList>

                <TabsContent value="controllers">
                  <SimpleTable
                    cols={["ID", "Name", "IP", "Location", "Confidence"]}
                    rows={parsed.controllers.map((c) => [c.controllerId, c.name, c.ip, c.location, c.confidence])}
                  />
                </TabsContent>
                <TabsContent value="devices">
                  <SimpleTable
                    cols={["Type", "Address", "Room", "Controller", "Confidence"]}
                    rows={parsed.devices.map((d) => [d.type, d.address, d.room, d.controllerId, d.confidence])}
                  />
                </TabsContent>
                <TabsContent value="rooms">
                  <SimpleTable
                    cols={["Name", "Path", "Devices"]}
                    rows={parsed.rooms.map((r) => [r.name, r.path, String(r.assignedDevices.length)])}
                  />
                </TabsContent>
                <TabsContent value="zones">
                  <SimpleTable
                    cols={["Name", "Type", "Controller", "Members"]}
                    rows={[
                      ...parsed.zones.map((z) => [z.name, z.type, z.controllerId, "—"]),
                      ...parsed.groupSignals.map((g) => [g.name, "GroupSignal", g.targetController, String(g.includedZones.length)]),
                    ]}
                  />
                </TabsContent>
                {isZip && (
                  <TabsContent value="files">
                    <FilesTab files={parsed.archive?.files || []} />
                  </TabsContent>
                )}
                {isZip && (
                  <TabsContent value="plugins">
                    <PluginsTab plugins={parsed.plugins || []} />
                  </TabsContent>
                )}
                {isZip && (
                  <TabsContent value="endpoints">
                    <EndpointsTab endpoints={parsed.endpoints || []} />
                  </TabsContent>
                )}
                <TabsContent value="unknown">
                  {(parsed.rawUnparsed && parsed.rawUnparsed.length > 0) ? (
                    <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                      {parsed.rawUnparsed.join("\n")}
                    </pre>
                  ) : (
                    <div className="rounded border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground">
                      No unsupported sections detected.
                    </div>
                  )}
                </TabsContent>
                {hasExistingConfig && diff && (
                  <TabsContent value="diff">
                    <DiffView diff={diff} />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {parsed && (
              <Button asChild size="sm" variant="ghost"
                onClick={() => setHandoff({
                  source: "deep-evidence",
                  mode: "explain_on_site",
                  context: {
                    affectedServices: ["CCP Import"],
                    affectedHosts: parsed.controllers.map((c) => c.ip).filter(Boolean),
                    contradictions: (parsed.structuredWarnings || [])
                      .filter((w) => w.severity !== "INFO")
                      .map((w) => ({ kind: w.code, sourceA: { layer: "config", said: w.title }, sourceB: { layer: "config", said: w.affectedObject || "—" }, why: w.explanation, likelyLayer: "configuration", confidence: 0.7 })),
                    deepEvidence: {
                      filename, status: parsed.status, confidence: parsed.confidence,
                      confidenceScore: parsed.confidenceScore, warnings: parsed.structuredWarnings,
                      controllers: parsed.controllers.length, devices: parsed.devices.length, rooms: parsed.rooms.length,
                    },
                  },
                })}>
                <Link to="/ai-commander">
                  <Brain className="mr-1.5 h-3.5 w-3.5" />
                  Ask AI Commander about this import
                </Link>
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={onConfirm} disabled={!canImport}
              className="bg-info text-info-foreground hover:bg-info/90">
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              {hasExistingConfig ? "Confirm overwrite" : "Confirm import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate text-xs ${mono ? "font-mono" : ""}`} title={value}>{value || "—"}</div>
    </div>
  );
}

function SimpleTable({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) {
    return <div className="rounded border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground">No entries.</div>;
  }
  return (
    <div className="max-h-64 overflow-auto rounded border border-border/40">
      <Table>
        <TableHeader>
          <TableRow>{cols.map((c) => <TableHead key={c} className="text-[11px]">{c}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((cell, j) => <TableCell key={j} className="font-mono text-[11px]">{String(cell)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DiffView({ diff }: { diff: CcpDiff }) {
  return (
    <div className="space-y-3">
      <DiffSection title="Added" tone="add" count={diff.controllers.added.length + diff.devices.added.length + diff.rooms.added.length}>
        {diff.controllers.added.map((c) => <li key={`ca-${c.id}`}>Controller <code>{c.id}</code> · {c.name} · {c.ip || "no ip"}</li>)}
        {diff.devices.added.map((d, i) => <li key={`da-${i}`}>Device {d.name || d.address} · ctrl {d.controllerId} · room {d.room}</li>)}
        {diff.rooms.added.map((r) => <li key={`ra-${r}`}>Room {r}</li>)}
      </DiffSection>
      <DiffSection title="Changed" tone="change" count={diff.controllers.changed.length}>
        {diff.controllers.changed.map((c) => (
          <li key={`cc-${c.id}`}>
            Controller <code>{c.id}</code> — fields: {c.fields.join(", ")}
            <div className="ml-4 mt-0.5 text-[11px] opacity-80">
              <div>before: {JSON.stringify(c.before)}</div>
              <div>after:  {JSON.stringify(c.after)}</div>
            </div>
          </li>
        ))}
      </DiffSection>
      <DiffSection title="Removed" tone="remove" count={diff.controllers.removed.length + diff.devices.removed.length}>
        {diff.controllers.removed.map((c) => <li key={`cr-${c.id}`}>Controller <code>{c.id}</code> · {c.name}</li>)}
        {diff.devices.removed.map((d, i) => <li key={`dr-${i}`}>Device {d.name} · {d.ip}</li>)}
      </DiffSection>
    </div>
  );
}

function DiffSection({ title, tone, count, children }: { title: string; tone: "add" | "change" | "remove"; count: number; children: React.ReactNode }) {
  const tones = {
    add:    "border-success/40 bg-success/10 text-success",
    change: "border-warning/40 bg-warning/10 text-warning",
    remove: "border-critical/40 bg-critical/10 text-critical",
  } as const;
  return (
    <div className={`rounded border p-2 ${tones[tone]}`}>
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase">
        <span>{title}</span><span className="font-mono">{count}</span>
      </div>
      <ul className="ml-4 list-disc space-y-0.5 text-[11px]">{count === 0 ? <li className="opacity-70 list-none">—</li> : children}</ul>
    </div>
  );
}