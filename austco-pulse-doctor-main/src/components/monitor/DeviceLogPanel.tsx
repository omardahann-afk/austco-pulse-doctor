import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Copy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

const TAIL_INTERVAL_MS = 3000;

type NormalizedEvent = {
  timestamp: string | null;
  sourceService: string;
  severity: "info" | "warning" | "critical";
  eventType: string;
  rawLine: string;
  normalizedMeaning: string;
  relatedServices: string[];
  confidenceImpact: { rootCauseHint: string; delta: number };
  correlationTags: string[];
  suggestedTechCheck: string;
  doNotDo?: string[];
  line: number;
};

type LogResp = {
  ok: boolean;
  path?: string;
  sizeBytes?: number;
  truncated?: boolean;
  lineCount?: number;
  fetchedAt?: string;
  lines?: string[];
  reason?: string;
  error?: string;
  allowed?: string[];
  normalized?: NormalizedEvent[];
  normalizedService?: string;
};

function severityClass(line: string): string {
  const u = line.toUpperCase();
  if (/(^|[^A-Z])(ERROR|FAIL|EXCEPTION|CRITICAL|FATAL)([^A-Z]|$)/.test(u)) return "text-red-400";
  if (/(^|[^A-Z])(WARN|WARNING)([^A-Z]|$)/.test(u)) return "text-amber-400";
  if (/(^|[^A-Z])DEBUG([^A-Z]|$)/.test(u)) return "text-muted-foreground/70";
  return "text-foreground/90";
}

export function DeviceLogPanel({
  deviceId,
  paths,
  needsPassword,
}: {
  deviceId: string;
  paths: string[];
  needsPassword: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState(paths[0] || "");
  const [lines, setLines] = useState<string>("100");
  const [filter, setFilter] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState<LogResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [tailing, setTailing] = useState(false);
  const tailTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tailTimer.current) clearInterval(tailTimer.current);
    };
  }, []);

  async function fetchLogs(silent = false) {
    if (needsPassword && !password) {
      if (!silent) toast.error("SSH password required");
      return;
    }
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/monitor/devices/${encodeURIComponent(deviceId)}/logs/recent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath || undefined, lines: Number(lines) || 100, sshPassword: password || undefined }),
      });
      const json: LogResp = await r.json();
      setData(json);
      if (!json.ok && !silent) {
        toast.error(`${json.reason || "log_error"}${json.error ? ": " + json.error : ""}`);
      }
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function startTail() {
    if (tailTimer.current) clearInterval(tailTimer.current);
    setTailing(true);
    void fetchLogs();
    tailTimer.current = setInterval(() => { void fetchLogs(true); }, TAIL_INTERVAL_MS);
  }
  function stopTail() {
    if (tailTimer.current) { clearInterval(tailTimer.current); tailTimer.current = null; }
    setTailing(false);
  }

  function copyAll() {
    if (!data?.lines?.length) return;
    void navigator.clipboard.writeText(data.lines.join("\n"));
    toast.success("Logs copied");
  }

  const visibleLines = (data?.lines || []).filter((l) => !filter || l.toLowerCase().includes(filter.toLowerCase()));

  if (paths.length === 0) {
    return (
      <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
        No log paths configured for this device. Edit the device to add log paths.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/5 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Log path</Label>
          <Select value={selectedPath} onValueChange={setSelectedPath}>
            <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {paths.map((p) => <SelectItem key={p} value={p} className="font-mono text-xs">{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[90px]">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Lines</Label>
          <Select value={lines} onValueChange={setLines}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["50", "100", "250", "500"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[140px] flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Filter</Label>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="grep…" className="h-8 text-xs" />
        </div>
        {needsPassword && (
          <div className="min-w-[160px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">SSH password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-8 text-xs" placeholder="required" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void fetchLogs()} disabled={loading || tailing}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          View Logs
        </Button>
        {!tailing ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={startTail}>
            <Play className="mr-1 h-3 w-3" /> Tail Logs
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={stopTail}>
            <Square className="mr-1 h-3 w-3" /> Stop Tail
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copyAll} disabled={!data?.lines?.length}>
          <Copy className="mr-1 h-3 w-3" /> Copy
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setData(null)}>
          <Trash2 className="mr-1 h-3 w-3" /> Clear
        </Button>
        {tailing && <span className="ml-1 text-[10px] text-emerald-400">● live (every {TAIL_INTERVAL_MS / 1000}s)</span>}
        {data?.fetchedAt && <span className="ml-auto text-[10px] text-muted-foreground">fetched {new Date(data.fetchedAt).toLocaleTimeString()}</span>}
      </div>

      {data && !data.ok && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
          <div className="font-semibold">{data.reason}</div>
          {data.error && <div className="mt-0.5 text-muted-foreground">{data.error}</div>}
        </div>
      )}

      {data?.ok && (
        <ScrollArea className="h-[280px] rounded border border-border/40 bg-black/40">
          <pre className="p-2 font-mono text-[11px] leading-snug">
            {visibleLines.length === 0 ? (
              <span className="text-muted-foreground">(no lines{filter ? " match filter" : ""})</span>
            ) : (
              visibleLines.map((l, i) => (
                <div key={i} className={severityClass(l)}>{l || " "}</div>
              ))
            )}
          </pre>
        </ScrollArea>
      )}

      {data?.ok && Array.isArray(data.normalized) && data.normalized.length > 0 && (
        <div className="rounded border border-border/40 bg-muted/10 p-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Log meaning</span>
            <span className="text-foreground/60">·</span>
            <span>{data.normalized.length} normalized event(s)</span>
            {data.normalizedService && <span className="ml-auto text-foreground/60">service: {data.normalizedService}</span>}
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-auto">
            {data.normalized.slice(0, 50).map((e, i) => (
              <div key={i} className="rounded border border-border/30 bg-background/40 p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={
                    e.severity === "critical" ? "rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"
                    : e.severity === "warning" ? "rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                    : "rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold"
                  }>{e.severity.toUpperCase()}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{e.eventType}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">line {e.line}</span>
                </div>
                <div className="mt-1 text-foreground">{e.normalizedMeaning}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Related: {e.relatedServices.join(", ") || "—"}
                </div>
                <div className="text-[10px] text-emerald-300/90">Check: {e.suggestedTechCheck}</div>
                {Array.isArray(e.doNotDo) && e.doNotDo.length > 0 && (
                  <div className="text-[10px] text-red-300/90">Do not: {e.doNotDo[0]}</div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  Confidence impact: +{e.confidenceImpact.delta} → {e.confidenceImpact.rootCauseHint}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}