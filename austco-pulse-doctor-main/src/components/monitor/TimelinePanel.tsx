import { useEffect, useState } from "react";
import { Clock, RefreshCw, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { intelligenceApi, type TimelineEvent, TIMELINE_UPDATED_EVENT } from "@/lib/intelligenceClient";
import { relativeTime } from "@/lib/monitorClient";

function sevDot(s: TimelineEvent["severity"]) {
  if (s === "critical") return "bg-red-500";
  if (s === "warning") return "bg-amber-500";
  return "bg-emerald-500/70";
}

export function TimelinePanel() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [source, setSource] = useState<string>("all");

  async function load() {
    setLoading(true);
    try {
      const r = await intelligenceApi.listTimeline({
        severity: severity === "all" ? undefined : severity,
        source: source === "all" ? undefined : source,
        limit: 300,
      });
      if (r.ok) setEvents(r.events);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    const onUpd = () => void load();
    window.addEventListener(TIMELINE_UPDATED_EVENT, onUpd);
    const t = setInterval(load, 15000);
    return () => { window.removeEventListener(TIMELINE_UPDATED_EVENT, onUpd); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, source]);

  const visible = events.filter((e) => !filter || (e.title + " " + (e.description || "") + " " + (e.deviceId || "")).toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-3.5 w-3.5" /> Failure Timeline
        </CardTitle>
        <Button size="sm" variant="outline" className="h-7" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-48 text-xs" />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["all", "info", "warning", "critical"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["all", "probe", "alert", "evidence", "log_pattern", "autopilot", "trace", "ai"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground">{visible.length} events</span>
        </div>
        <div className="max-h-[320px] space-y-1 overflow-y-auto rounded border border-border/40 bg-muted/5 p-2">
          {visible.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">No events.</div>}
          {visible.map((e) => (
            <div key={e.eventId} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/20">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${sevDot(e.severity)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{e.source}</span>
                  <span className="truncate text-xs font-medium">{e.title}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {e.deviceId ? `${e.deviceId} · ` : ""}{relativeTime(e.createdAt)}
                  {e.description ? ` — ${e.description}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}