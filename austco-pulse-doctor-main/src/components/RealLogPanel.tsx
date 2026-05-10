import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChevronDown, ChevronRight, FileSearch, ServerCog, AlertOctagon, AlertTriangle,
  CheckCircle2, XCircle, Plus, X, FileWarning, Clipboard,
} from "lucide-react";
import {
  type ServiceTarget, type ServiceLogResult, type LogBreakpoint,
  analyzeRawText, inferLogBreakpoint, summarizeLogs,
} from "@/lib/logEngine";

type Props = {
  services: ServiceTarget[];
  onChange: (next: ServiceTarget[]) => void;
  results: ServiceLogResult[] | null;          // from backend logAnalysis
  manualResults: ServiceLogResult[];           // from pasted log text
  onManualAdd: (r: ServiceLogResult) => void;
  onManualClear: () => void;
};

export function RealLogPanel({ services, onChange, results, manualResults, onManualAdd, onManualClear }: Props) {
  const all = [...(results ?? []), ...manualResults];
  const breakpoint: LogBreakpoint | null = all.length ? inferLogBreakpoint(all) : null;
  const summary = summarizeLogs(all);

  return (
    <div className="space-y-4">
      <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4 text-info" />
            Service Log Targets
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">SSH 22 · sent to local bridge</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-[1.2fr_1fr_70px_90px_90px_1.5fr_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Service</span><span>VM IP</span><span>Port</span><span>User</span><span>Pass</span><span>Log Path</span><span></span>
          </div>
          {services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_1fr_70px_90px_90px_1.5fr_auto] gap-2 items-center">
              <Input value={s.name} onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="h-8 text-xs" />
              <Input value={s.ip} placeholder="10.20.1.20" className="h-8 font-mono text-xs"
                onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, ip: e.target.value } : x))} />
              <Input value={String(s.port)} className="h-8 font-mono text-xs"
                onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, port: Number(e.target.value) || 22 } : x))} />
              <Input value={s.username} className="h-8 text-xs"
                onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, username: e.target.value } : x))} />
              <Input value={s.password} type="password" className="h-8 text-xs"
                onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, password: e.target.value } : x))} />
              <Input value={s.logPaths.join(",")} className="h-8 font-mono text-[11px]"
                onChange={(e) => onChange(services.map((x, j) => j === i ? { ...x, logPaths: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : x))} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-critical"
                onClick={() => onChange(services.filter((_, j) => j !== i))}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-8"
            onClick={() => onChange([...services, { name: "Custom Service", ip: "", port: 22, username: "tech", password: "tech", logPaths: ["/var/log/syslog"] }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add service
          </Button>
        </CardContent>
      </Card>

      {/* Manual paste fallback */}
      <ManualLogIngest onAdd={onManualAdd} onClear={onManualClear} hasManual={manualResults.length > 0} />

      {/* Results */}
      {all.length > 0 && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4 text-info" /> Real Log Analysis
              <span className="ml-auto flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
                <Badge variant="outline" className="border-critical/40 text-critical">{summary.totalErrors} errors</Badge>
                <Badge variant="outline" className="border-warning/40 text-warning">{summary.totalWarnings} warnings</Badge>
                {summary.unreachable > 0 && <Badge variant="outline" className="border-critical/40 text-critical">{summary.unreachable} unreachable</Badge>}
                {summary.missing > 0 && <Badge variant="outline" className="border-warning/40 text-warning">{summary.missing} log missing</Badge>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>SSH</TableHead>
                  <TableHead>Log</TableHead>
                  <TableHead>Last log</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((r, i) => <LogRow key={`${r.service}-${i}`} r={r} />)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Log-driven breakpoint */}
      {breakpoint && (
        <Card className="border-critical/40 bg-gradient-to-br from-critical/15 to-critical/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-critical">
              <AlertOctagon className="h-4 w-4" /> Log-Driven Root Cause
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-critical">Break found at</div>
              <div className="mt-0.5 text-lg font-semibold">{breakpoint.failedHandoff}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
              <pre className="overflow-x-auto rounded-md border border-border/50 bg-background/40 p-2 font-mono text-[11px]">{breakpoint.evidence}</pre>
              {breakpoint.timestamp && <div className="text-[11px] text-muted-foreground">Timestamp: <span className="font-mono">{breakpoint.timestamp}</span></div>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Responsible service</div>
                <div className="mt-0.5 font-medium">{breakpoint.responsibleService}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Likely cause</div>
                <div className="mt-0.5 text-foreground/85">{breakpoint.likelyCause}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fix</div>
              <div className="mt-0.5 text-foreground/85">{breakpoint.recommendedFix}</div>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8"
              onClick={() => navigator.clipboard.writeText(formatBreakpoint(breakpoint))}>
              <Clipboard className="mr-1.5 h-3.5 w-3.5" /> Copy escalation summary
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatBreakpoint(b: LogBreakpoint) {
  return [
    `Break found at: ${b.failedHandoff}`,
    `Responsible service: ${b.responsibleService}`,
    `Evidence: ${b.evidence}`,
    b.timestamp ? `Timestamp: ${b.timestamp}` : "",
    `Likely cause: ${b.likelyCause}`,
    `Fix: ${b.recommendedFix}`,
  ].filter(Boolean).join("\n");
}

function LogRow({ r }: { r: ServiceLogResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
        <TableCell className="font-medium">{r.service}</TableCell>
        <TableCell className="font-mono text-xs">{r.ip || "—"}</TableCell>
        <TableCell>
          {r.status === "reachable"
            ? <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success"><CheckCircle2 className="h-3 w-3" />OK</span>
            : <span className="inline-flex items-center gap-1 rounded bg-critical/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-critical"><XCircle className="h-3 w-3" />Down</span>}
        </TableCell>
        <TableCell>
          {r.logStatus === "found"
            ? <Badge variant="outline" className="border-success/40 text-success">found</Badge>
            : <Badge variant="outline" className="border-warning/40 text-warning">missing</Badge>}
        </TableCell>
        <TableCell className="font-mono text-[11px] text-muted-foreground">{r.lastUpdated ?? "—"}</TableCell>
        <TableCell className="text-right font-mono text-xs text-critical">{r.errors.length}</TableCell>
        <TableCell className="text-right font-mono text-xs text-warning">{r.warnings.length}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/5 hover:bg-muted/5">
          <TableCell colSpan={8} className="p-0">
            <div className="space-y-2 border-t border-border/50 p-3">
              {r.error && (
                <div className="flex items-start gap-2 rounded border border-critical/30 bg-critical/5 p-2 text-xs text-critical">
                  <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="font-mono">{r.error}</span>
                </div>
              )}
              {r.errors.slice(0, 5).map((l, i) => (
                <div key={`e-${i}`} className="flex items-start gap-2 text-[11px]">
                  <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0 text-critical" />
                  <span className="font-mono text-muted-foreground">{l.ts ?? ""}</span>
                  <span className="font-mono">{l.text}</span>
                </div>
              ))}
              {r.warnings.slice(0, 3).map((l, i) => (
                <div key={`w-${i}`} className="flex items-start gap-2 text-[11px]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  <span className="font-mono text-muted-foreground">{l.ts ?? ""}</span>
                  <span className="font-mono">{l.text}</span>
                </div>
              ))}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last 50 lines</div>
                <pre className="max-h-72 overflow-auto rounded border border-border/40 bg-background/40 p-2 font-mono text-[10px] leading-relaxed">
{r.tail.join("\n") || "(no lines)"}
                </pre>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ManualLogIngest({ onAdd, onClear, hasManual }: { onAdd: (r: ServiceLogResult) => void; onClear: () => void; hasManual: boolean }) {
  const [service, setService] = useState("Pulse Gateway");
  const [ip, setIp] = useState("");
  const [text, setText] = useState("");
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileWarning className="h-4 w-4 text-warning" /> Manual log paste (WinSCP / SFTP fallback)
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">Use when SSH from the bridge is unavailable</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Service</Label>
            <Input value={service} onChange={(e) => setService(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">IP</Label>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.20.1.20" className="h-8 font-mono text-xs" />
          </div>
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder="Paste log file contents (last ~2000 lines). Parser will extract errors, warnings, and ACTIVE/CANCEL/OUTPUT/ACK signals."
          className="font-mono text-[11px]" />
        <div className="flex justify-end gap-2">
          {hasManual && <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClear}>Clear pasted</Button>}
          <Button type="button" size="sm" className="h-8"
            disabled={!text.trim()}
            onClick={() => { onAdd(analyzeRawText(service, ip, text)); setText(""); }}>
            Parse & add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
