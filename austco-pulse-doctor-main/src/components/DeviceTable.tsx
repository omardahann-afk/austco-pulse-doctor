import { useMemo, useState } from "react";
import type { AustcoDevice, DeviceType } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "./StatusPill";
import { Search } from "lucide-react";

type Filter = "all" | DeviceType | "critical";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Primary Server", label: "Servers" },
  { id: "Controller", label: "Controllers" },
  { id: "IP-IN8", label: "IP-IN8" },
  { id: "IP-APP1", label: "IP-APP1" },
  { id: "Signal Light", label: "Signal Lights" },
  { id: "Switch", label: "Switches" },
  { id: "critical", label: "Critical only" },
];

import { useEffect, useState as useReactState } from "react";

function RelTime({ iso }: { iso?: string }) {
  const [text, setText] = useReactState("—");
  useEffect(() => {
    if (!iso) { setText("—"); return; }
    const fmt = () => {
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      return `${Math.floor(s / 3600)}h ago`;
    };
    setText(fmt());
    const t = setInterval(() => setText(fmt()), 5000);
    return () => clearInterval(t);
  }, [iso]);
  return <>{text}</>;
}

export function DeviceTable({ devices }: { devices: AustcoDevice[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => devices.filter((d) => {
    if (filter === "critical" && d.status !== "Critical") return false;
    if (filter !== "all" && filter !== "critical") {
      if (filter === "Primary Server") {
        if (!["Primary Server", "Secondary Server", "Virtual IP", "Pulse Server"].includes(d.type)) return false;
      } else if (d.type !== filter) return false;
    }
    if (q && !`${d.name} ${d.ip} ${d.location ?? ""} ${d.issue ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [devices, filter, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="bg-muted/40">
            {FILTERS.map((f) => <TabsTrigger key={f.id} value={f.id} className="text-xs">{f.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, IP, location, issue…" className="h-8 w-72 pl-8 text-xs" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card/60 shadow-[var(--shadow-panel)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Firmware</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium text-right">Latency</th>
              <th className="px-3 py-2 font-medium">Heartbeat</th>
              <th className="px-3 py-2 font-medium">Switch port</th>
              <th className="px-3 py-2 font-medium">Issue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-border/40 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{d.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.type}</td>
                <td className="px-3 py-2 font-mono text-xs">{d.ip}</td>
                <td className="px-3 py-2"><StatusPill status={d.status} /></td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.firmware ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.location ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{d.latencyMs?.toFixed(1) ?? "—"} ms</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground"><RelTime iso={d.lastHeartbeat} /></td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.switchPort ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-warning">{d.issue ?? <span className="text-muted-foreground">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
