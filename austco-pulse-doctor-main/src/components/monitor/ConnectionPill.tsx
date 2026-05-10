import { Wifi, WifiOff, Loader2, CircleDashed } from "lucide-react";
import { type MonitorConn } from "@/hooks/useMonitorBus";

export function ConnectionPill({ conn, lastEventAt }: { conn: MonitorConn; lastEventAt: string | null }) {
  let label = "Live";
  let cls = "border-emerald-500/30 text-emerald-400";
  let Icon = Wifi;
  if (conn === "connecting") { label = "Connecting"; cls = "border-amber-500/30 text-amber-400"; Icon = Loader2; }
  else if (conn === "closed") { label = "Reconnecting"; cls = "border-red-500/30 text-red-400"; Icon = WifiOff; }
  else if (conn === "offline") { label = "Offline"; cls = "border-slate-500/30 text-slate-300"; Icon = CircleDashed; }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-card/40 px-2.5 py-1 text-[11px] font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${conn === "connecting" ? "animate-spin" : ""}`} />
      {label}
      {lastEventAt && conn === "open" && (
        <span className="text-muted-foreground/70">· events live</span>
      )}
    </span>
  );
}